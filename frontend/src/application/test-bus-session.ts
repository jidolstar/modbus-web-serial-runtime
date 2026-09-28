import { RUNTIME_CONFIG } from './runtime-config'
import { ApiDeviceCatalog } from '../device-catalog/api-device-catalog'
import { ModbusRtuClient } from '../modbus/modbus-rtu-client'
import { RecipeExecutor } from '../recipe-engine/recipe-executor'
import { SerialDisconnectReason } from '../serial/serial-connection-state'
import type { SerialTransport } from '../serial/serial-transport'
import { WebSerialTransport } from '../serial/web-serial-transport'

/** Scan, Test Device와 Test Group이 하나의 Web Serial port와 Modbus transaction queue를 공유하도록 소유한다. */
export class TestBusSession {
  public readonly modbusClient: ModbusRtuClient
  public readonly catalog: ApiDeviceCatalog
  public readonly recipeExecutor: RecipeExecutor
  #hasSelectedPort = false

  public constructor(public readonly transport: SerialTransport = new WebSerialTransport()) {
    this.modbusClient = new ModbusRtuClient(transport, RUNTIME_CONFIG.modbusTransactionTimeoutMs)
    this.catalog = new ApiDeviceCatalog()
    this.recipeExecutor = new RecipeExecutor(this.catalog, this.modbusClient, transport)
  }

  public get isSupported(): boolean { return this.transport.isSupported }
  public get hasSelectedPort(): boolean { return this.#hasSelectedPort }

  /**
   * 연결·Scan 버튼의 사용자 클릭에서 호출해 브라우저의 port chooser 권한 조건을 충족한다.
   * 이전 화면의 연결 종료가 누락돼도 열린 port 참조를 덮어쓰지 않도록 먼저 close를 완료한다.
   */
  public async requestPort(): Promise<void> {
    await this.close()
    await this.transport.requestPort()
    this.#hasSelectedPort = true
  }

  /** 내부 화면 전환 시 선택 권한은 유지하되 열린 stream과 대기 중 transaction을 안전하게 닫는다. */
  public async close(): Promise<void> {
    await this.transport.close(SerialDisconnectReason.UserRequested)
  }

  /** 인증 화면 이탈 시 공유 port, queue와 browser event 구독을 함께 정리한다. */
  public async dispose(): Promise<void> {
    this.modbusClient.dispose()
    await this.transport.dispose()
    this.#hasSelectedPort = false
  }
}

/** 현재 인증 Dashboard가 소유하고 하위 Catalog·Scan·Test Device 화면이 공유하는 bus session이다. */
export const testBusSession = new TestBusSession()
