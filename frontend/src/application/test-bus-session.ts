import { RUNTIME_CONFIG } from './runtime-config'
import { ApiDeviceCatalog } from '../device-catalog/api-device-catalog'
import { ModbusRtuClient } from '../modbus/modbus-rtu-client'
import { RecipeExecutor } from '../recipe-engine/recipe-executor'
import { SerialDisconnectReason } from '../serial/serial-connection-state'
import { WebSerialTransport } from '../serial/web-serial-transport'

/** 여러 Test Device가 하나의 Web Serial port와 Modbus transaction queue를 공유하도록 소유한다. */
export class TestBusSession {
  public readonly transport = new WebSerialTransport()
  public readonly modbusClient = new ModbusRtuClient(this.transport, RUNTIME_CONFIG.modbusTransactionTimeoutMs)
  public readonly catalog = new ApiDeviceCatalog()
  public readonly recipeExecutor = new RecipeExecutor(this.catalog, this.modbusClient, this.transport)
  #hasSelectedPort = false

  public get isSupported(): boolean { return this.transport.isSupported }
  public get hasSelectedPort(): boolean { return this.#hasSelectedPort }

  /** 생성 모달의 사용자 클릭에서 호출해 브라우저의 port chooser 권한 조건을 충족한다. */
  public async requestPort(): Promise<void> {
    await this.transport.requestPort()
    this.#hasSelectedPort = true
  }

  /** Dashboard 이탈 시 선택 권한은 유지하되 열린 stream을 안전하게 닫는다. */
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
