import { ModbusExceptionError, ModbusTimeoutError } from '../modbus/modbus-errors'
import type { ModbusClient } from '../modbus/modbus-types'
import { SerialDisconnectedError } from '../serial/serial-errors'
import type { SerialTransport } from '../serial/serial-transport'
import { SerialFlowControl, SerialParity, type SerialConfig } from '../serial/serial-types'
import { findErrorCause, OperationAbortedError, throwIfOperationAborted } from './operation-errors'

const SERIAL_REOPEN_SETTLE_MS = 100 // baudrate 변경 후 USB-RS485와 RTU 무통신 구간을 안정화하는 대기시간. 예: 100ms
export const STANDARD_MODBUS_BAUD_RATES = Object.freeze([
  1_200, 2_400, 4_800, 9_600, 19_200, 38_400, 57_600, 115_200,
]) // 현장에서 사용할 가능성이 있는 1차 장비 Scan baudrate 목록. 저속 300·600은 Scan 시간 때문에 제외한다.

export enum CatalogScanStage {
  Discovery = 'discovery', // 주소 응답만 빠르게 확인하는 1차 단계
}

/** Catalog-aware Scan이 serial 설정과 Slave ID 한 조합을 판정한 결과다. */
export enum CatalogScanStatus {
  Discovered = 'discovered', // 8N1의 baudrate·Slave ID 조합에서 Modbus 응답을 확인한 상태
}

export interface CatalogScanRequest {
  readonly baudRates: ReadonlyArray<number> // 사용자가 탐색할 baudrate. 예: [4800, 9600]
  readonly slaveIds: ReadonlyArray<number> // 사용자가 탐색할 Slave ID. 예: [1, 2, 3]
}

export interface CatalogScanResult {
  readonly serialConfig: SerialConfig // 실제 port에 적용한 설정. 예: 9600/8N1
  readonly slaveId: number // 응답을 확인한 Modbus 주소. 예: 100
  readonly status: CatalogScanStatus // 장비 응답 확인 상태. 현재는 discovered만 사용한다.
}

export interface CatalogScanProgress {
  readonly stage: CatalogScanStage // 현재 진행 중인 응답 Scan 단계
  readonly completed: number // 판정이 끝난 serial/Slave 조합 수
  readonly total: number // 이번 Scan에서 판정할 전체 조합 수
  readonly result?: CatalogScanResult // 장비 응답을 받았을 때 전달하는 발견 결과
  readonly currentSerialConfig: SerialConfig // 현재 port에 적용해 처리 중인 설정. 예: 9600/8N1
  readonly currentSlaveId: number // 현재 Scan 중인 Slave ID. 예: 7
}

export type CatalogScanProgressListener = (progress: CatalogScanProgress) => void

interface ScanTarget {
  readonly serialConfig: SerialConfig
  readonly slaveId: number
}

/**
 * Scan 화면에서 Catalog와 무관하게 baudrate·Slave ID의 Modbus 응답만 찾는다.
 * ModbusClient의 안전한 FC03 읽기와 SerialTransport 재연결에만 의존한다.
 */
export class CatalogAwareScanner {
  public constructor(
    private readonly serialTransport: SerialTransport,
    private readonly modbusClient: ModbusClient,
    private readonly serialReopenSettleMs = SERIAL_REOPEN_SETTLE_MS,
  ) {}

  /** 사용자 Scan 시작에서 호출해 모든 안전한 조합을 순차 판정하고 진행률을 전달한다. */
  public async scan(
    request: CatalogScanRequest,
    onProgress?: CatalogScanProgressListener,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<CatalogScanResult>> {
    const targets = this.#buildTargets(request)
    const results: CatalogScanResult[] = []
    let currentConfigKey = ''

    for (const [index, target] of targets.entries()) {
      throwIfOperationAborted(signal)
      const configKey = this.#serialConfigKey(target.serialConfig)
      if (configKey !== currentConfigKey) {
        await this.#reopenAndSettle(target.serialConfig, signal)
        currentConfigKey = configKey
      }
      // timeout을 기다리는 동안에도 UI가 실제 요청 중인 조합을 보여주도록 I/O 전에 알린다.
      onProgress?.(Object.freeze({
        stage: CatalogScanStage.Discovery,
        completed: index,
        total: targets.length,
        currentSerialConfig: target.serialConfig,
        currentSlaveId: target.slaveId,
      }))
      const responded = await this.#hasResponse(target, signal)
      const result = responded ? this.#discoveredResult(target) : undefined
      if (result) results.push(result)
      onProgress?.(Object.freeze({
        stage: CatalogScanStage.Discovery,
        completed: index + 1,
        total: targets.length,
        ...(result ? { result } : {}),
        currentSerialConfig: target.serialConfig,
        currentSlaveId: target.slaveId,
      }))
    }

    return Object.freeze(results)
  }

  /** Catalog와 무관하게 선택한 표준 baudrate와 Slave ID의 8N1 Scan 조합을 만든다. */
  #buildTargets(request: CatalogScanRequest): ReadonlyArray<ScanTarget> {
    const baudRates = [...new Set(request.baudRates)]
    const slaveIds = [...new Set(request.slaveIds)]
    if (baudRates.length === 0) throw new Error('Scan할 baudrate가 없습니다.')
    if (slaveIds.length === 0) throw new Error('Scan할 Slave ID가 없습니다.')
    if (baudRates.some((value) => !Number.isInteger(value) || value < 300 || value > 4_000_000)) throw new Error('Scan baudrate 범위가 올바르지 않습니다.')
    if (slaveIds.some((value) => !Number.isInteger(value) || value < 1 || value > 247)) throw new Error('Scan Slave ID는 1~247 정수여야 합니다.')

    const targets: ScanTarget[] = []
    for (const baudRate of baudRates) {
      const serialConfig = Object.freeze({ baudRate, dataBits: 8 as const, stopBits: 1 as const, parity: SerialParity.None, flowControl: SerialFlowControl.None })
      for (const slaveId of slaveIds) {
        targets.push(Object.freeze({ serialConfig, slaveId }))
      }
    }
    return Object.freeze(targets)
  }

  /** 1차 Scan에서 FC03 성공과 Modbus exception을 모두 해당 주소의 응답으로 인정한다. */
  async #hasResponse(target: ScanTarget, signal?: AbortSignal): Promise<boolean> {
    throwIfOperationAborted(signal)
    try {
      await this.modbusClient.readHoldingRegisters(target.slaveId, 0, 1)
      return true
    } catch (error) {
      if (findErrorCause(error, ModbusExceptionError)) return true
      if (findErrorCause(error, ModbusTimeoutError)) return false
      if (findErrorCause(error, SerialDisconnectedError)) throw error
      return false
    }
  }

  /** 응답을 확인한 조합만 결과 목록에 추가할 불변 객체로 만든다. */
  #discoveredResult(target: ScanTarget): CatalogScanResult {
    return Object.freeze({
      serialConfig: target.serialConfig,
      slaveId: target.slaveId,
      status: CatalogScanStatus.Discovered,
    })
  }

  #serialConfigKey(config: SerialConfig): string {
    return `${config.baudRate}:${config.dataBits}:${config.stopBits}:${config.parity}:${config.flowControl}`
  }

  /** baudrate를 바꾼 직후 이전 frame 잔여 신호가 다음 Slave 요청으로 섞이지 않도록 잠시 기다린다. */
  async #reopenAndSettle(config: SerialConfig, signal?: AbortSignal): Promise<void> {
    await this.serialTransport.reopen(config)
    if (this.serialReopenSettleMs > 0) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, this.serialReopenSettleMs))
    }
    throwIfOperationAborted(signal)
  }
}
