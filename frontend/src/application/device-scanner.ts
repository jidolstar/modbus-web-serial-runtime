import type { DeviceCatalog } from '../device-catalog/catalog.types'
import { STANDARD_DEVICE_ID_PARAMETER } from '../device-catalog/recipe.types'
import { ModbusExceptionError, ModbusTimeoutError } from '../modbus/modbus-errors'
import type { RecipeRunner } from '../recipe-engine/recipe-execution.types'
import { RecipeAbortedError } from '../recipe-engine/recipe-execution-errors'
import { SerialDisconnectedError } from '../serial/serial-errors'
import type { SerialTransport } from '../serial/serial-transport'
import type { SerialConfig } from '../serial/serial-types'
import { findErrorCause, OperationAbortedError, throwIfOperationAborted } from './operation-errors'

/** Probe 한 번에서 관찰한 장비 응답 종류다. */
export enum DeviceScanResponseStatus {
  Responded = 'responded',
  ModbusException = 'modbus-exception',
  NoResponse = 'no-response',
  Failed = 'failed',
}

/** Scanner가 순회할 Profile, 통신 설정과 Slave ID 목록이다. */
export interface DeviceScanRequest {
  /** 탐색할 장비 종류의 Profile ID다. */
  readonly profileId: string

  /** Scanner가 순서대로 port에 적용할 통신 설정 목록이다. */
  readonly serialConfigs: ReadonlyArray<SerialConfig>

  /** 각 통신 설정에서 순서대로 Probe할 Slave ID 목록이다. */
  readonly slaveIds: ReadonlyArray<number>
}

/** baudrate/Slave ID 조합 하나의 불변 Probe 결과다. */
export interface DeviceScanAttempt {
  /** 이 Probe에 실제 적용한 Serial 설정이다. */
  readonly serialConfig: SerialConfig

  /** Probe한 Modbus Slave ID다. */
  readonly slaveId: number

  /** 정상 응답, exception, 무응답 또는 기타 실패의 분류다. */
  readonly status: DeviceScanResponseStatus

  /** Modbus exception 응답일 때 장비가 반환한 exception code다. */
  readonly exceptionCode?: number

  /** 기타 실패를 진단하기 위한 원본 오류다. */
  readonly error?: Error
}

/** Scan 진행 결과를 조합 하나씩 받는 callback이다. */
export type DeviceScanProgressListener = (attempt: DeviceScanAttempt) => void

/**
 * Profile의 read-only Probe Recipe로 baudrate/Slave ID 조합을 순차 탐색한다.
 *
 * Modbus exception도 해당 ID에서 유효한 RTU 응답이 온 것이므로 장비 존재 신호로
 * 별도 기록한다. 응답만으로 동일 ID 장비 충돌까지 판정하지는 않는다.
 */
export class DeviceScanner {
  public constructor(
    private readonly catalog: DeviceCatalog,
    private readonly recipeRunner: RecipeRunner,
    private readonly serialTransport: SerialTransport,
  ) {}

  /** 지정된 순서로 모든 통신 설정과 Slave ID를 Probe하고 불변 결과를 반환한다. */
  public async scan(
    request: DeviceScanRequest,
    onProgress?: DeviceScanProgressListener,
    signal?: AbortSignal,
  ): Promise<ReadonlyArray<DeviceScanAttempt>> {
    const profile = this.catalog.getProfile(request.profileId)
    this.#validateRequest(profile, request)
    const attempts: DeviceScanAttempt[] = []

    for (const serialConfig of request.serialConfigs) {
      throwIfOperationAborted(signal)
      await this.serialTransport.reopen(serialConfig)

      for (const slaveId of request.slaveIds) {
        throwIfOperationAborted(signal)
        const attempt = await this.#probe(profile.id, profile.recipes.probe, serialConfig, slaveId, signal)
        attempts.push(attempt)
        onProgress?.(attempt)
      }
    }
    return Object.freeze(attempts)
  }

  /** Profile 범위를 벗어난 scan 값은 port 설정 전에 차단한다. */
  #validateRequest(
    profile: ReturnType<DeviceCatalog['getProfile']>,
    request: DeviceScanRequest,
  ): void {
    if (request.serialConfigs.length === 0) throw new Error('Scan할 Serial 설정이 없습니다.')
    if (request.slaveIds.length === 0) throw new Error('Scan할 Slave ID가 없습니다.')

    for (const config of request.serialConfigs) {
      if (!profile.serial.supportedBaudRates.includes(config.baudRate)) {
        throw new Error(`Profile이 지원하지 않는 scan baudrate입니다: ${config.baudRate}`)
      }
    }
    for (const slaveId of request.slaveIds) {
      if (!Number.isInteger(slaveId)
        || slaveId < profile.slave.minId
        || slaveId > profile.slave.maxId) {
        throw new Error(`Scan Slave ID는 ${profile.slave.minId}~${profile.slave.maxId} 정수여야 합니다.`)
      }
    }
  }

  /** Probe 오류 원인을 응답, exception, timeout, 그 밖의 실패로 구분한다. */
  async #probe(
    profileId: string,
    probeRecipeId: string,
    serialConfig: SerialConfig,
    slaveId: number,
    signal?: AbortSignal,
  ): Promise<DeviceScanAttempt> {
    try {
      await this.recipeRunner.execute(
        profileId,
        probeRecipeId,
        { [STANDARD_DEVICE_ID_PARAMETER]: slaveId },
        signal,
      )
      return Object.freeze({ serialConfig, slaveId, status: DeviceScanResponseStatus.Responded })
    } catch (error) {
      if (signal?.aborted
        || error instanceof RecipeAbortedError
        || error instanceof OperationAbortedError) {
        throw new OperationAbortedError('장비 Scan이 취소되었습니다.', { cause: error })
      }
      const modbusException = findErrorCause(error, ModbusExceptionError)
      if (modbusException) {
        return Object.freeze({
          serialConfig,
          slaveId,
          status: DeviceScanResponseStatus.ModbusException,
          exceptionCode: modbusException.exceptionCode,
        })
      }
      if (findErrorCause(error, ModbusTimeoutError)) {
        return Object.freeze({ serialConfig, slaveId, status: DeviceScanResponseStatus.NoResponse })
      }
      if (findErrorCause(error, SerialDisconnectedError)) throw error
      return Object.freeze({
        serialConfig,
        slaveId,
        status: DeviceScanResponseStatus.Failed,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }
}
