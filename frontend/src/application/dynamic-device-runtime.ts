import type { DeviceCatalog } from '../device-catalog/catalog.types'
import { STANDARD_DEVICE_ID_PARAMETER } from '../device-catalog/recipe.types'
import type { RecipeNamedOutput } from '../recipe-engine/recipe-execution.types'
import {
  SerialConnectionState,
  SerialDisconnectReason,
  type SerialConnectionStateEvent,
} from '../serial/serial-connection-state'
import type { SerialTransport } from '../serial/serial-transport'
import type { Unsubscribe } from '../serial/serial-types'
import type { SensorMonitorControl } from './sensor-monitor'

/** Runtime이 연결하고 주기 측정할 장비 instance 선택값이다. */
export interface DeviceConnectionRequest {
  readonly profileId: string
  readonly slaveId: number
  readonly baudRate: number
  readonly measurementRecipeId?: string // 생략하면 Profile의 첫 measurement를 사용한다.
  readonly requestPort?: boolean // false이면 상위 TestBusSession이 이미 선택한 port를 사용한다.
}

/** UI adapter가 구독하는 Runtime의 불변 상태다. */
export interface DeviceRuntimeSnapshot {
  readonly initialized: boolean
  readonly connectionState: SerialConnectionState
  readonly activeDevice: DeviceConnectionRequest | null
  readonly activeMeasurementRecipeId: string | null
  readonly outputs: Readonly<Record<string, RecipeNamedOutput>>
  readonly lastUpdatedAt: Date | null
  readonly error: Error | null
}

/** Runtime 상태 변경을 받는 observer 함수다. */
export type DeviceRuntimeListener = (snapshot: DeviceRuntimeSnapshot) => void

/**
 * Catalog, Serial 연결과 SensorMonitor 수명주기를 조정하는 Application Service다.
 *
 * 장비별 register 주소나 scale을 알지 않으며 Profile이 허용한 measurement Recipe를
 * 실행한다. 연결이 끝나거나 Recipe가 바뀌면 기존 polling session은 자동 폐기된다.
 */
export class DynamicDeviceRuntime {
  readonly #listeners = new Set<DeviceRuntimeListener>()
  readonly #unsubscribeConnectionState: Unsubscribe
  #initializationPromise: Promise<void> | null = null
  #snapshot: DeviceRuntimeSnapshot

  public constructor(
    private readonly catalog: DeviceCatalog,
    private readonly serialTransport: SerialTransport,
    private readonly sensorMonitor: SensorMonitorControl,
  ) {
    this.#snapshot = this.#createSnapshot({
      initialized: false,
      connectionState: serialTransport.connectionState,
      activeDevice: null,
      activeMeasurementRecipeId: null,
      outputs: Object.freeze({}),
      lastUpdatedAt: null,
      error: null,
    })
    this.#unsubscribeConnectionState = serialTransport.subscribeConnectionState(
      (event) => this.#handleConnectionStateChange(event),
    )
  }

  public get snapshot(): DeviceRuntimeSnapshot {
    return this.#snapshot
  }

  /** Catalog를 한 번만 로드하며 동시에 호출돼도 같은 초기화 Promise를 공유한다. */
  public initialize(): Promise<void> {
    if (this.#snapshot.initialized) return Promise.resolve()
    if (this.#initializationPromise) return this.#initializationPromise

    this.#initializationPromise = this.catalog.load()
      .then(() => this.#updateSnapshot({ initialized: true, error: null }))
      .catch((error) => {
        const normalizedError = this.#toError(error)
        this.#updateSnapshot({ error: normalizedError })
        throw normalizedError
      })
      .finally(() => { this.#initializationPromise = null })
    return this.#initializationPromise
  }

  /** 사용자 동작에서 port를 선택하고 Profile 설정으로 새 측정 session을 시작한다. */
  public async connect(request: DeviceConnectionRequest): Promise<void> {
    await this.initialize()
    const profile = this.catalog.getProfile(request.profileId)
    this.#validateConnectionRequest(profile, request)
    const measurementRecipeId = request.measurementRecipeId ?? profile.recipes.measurements?.[0]
    if (!measurementRecipeId) throw new Error(`측정 Recipe가 없는 Profile입니다: ${profile.id}`)
    this.#validateMeasurementRecipe(profile, measurementRecipeId)

    this.sensorMonitor.stop()
    this.#updateSnapshot({ activeDevice: request, activeMeasurementRecipeId: measurementRecipeId, outputs: Object.freeze({}), error: null })
    try {
      if (request.requestPort !== false) await this.serialTransport.requestPort()
      await this.serialTransport.open(Object.freeze({
        ...profile.serial.default,
        baudRate: request.baudRate,
      }))
      this.#startMeasurement(profile.id, measurementRecipeId, request.slaveId)
    } catch (error) {
      const normalizedError = this.#toError(error)
      this.#updateSnapshot({ error: normalizedError })
      throw normalizedError
    }
  }

  /** Test Device 화면에서 측정 종류를 바꿀 때 port를 유지하고 polling session만 교체한다. */
  public selectMeasurement(measurementRecipeId: string): void {
    const activeDevice = this.#snapshot.activeDevice
    if (this.#snapshot.connectionState !== SerialConnectionState.Connected || !activeDevice) {
      throw new Error('연결된 테스트 장비에서만 측정 항목을 변경할 수 있습니다.')
    }
    const profile = this.catalog.getProfile(activeDevice.profileId)
    this.#validateMeasurementRecipe(profile, measurementRecipeId)
    this.#updateSnapshot({ activeMeasurementRecipeId: measurementRecipeId, outputs: Object.freeze({}), lastUpdatedAt: null, error: null })
    this.#startMeasurement(profile.id, measurementRecipeId, activeDevice.slaveId)
  }

  /** polling을 먼저 중단한 뒤 사용자의 정상 종료 사유로 port를 닫는다. */
  public async disconnect(): Promise<void> {
    this.sensorMonitor.stop()
    await this.serialTransport.close(SerialDisconnectReason.UserRequested)
    this.#updateSnapshot({ error: null })
  }

  /** UI adapter가 Runtime 상태를 관찰하도록 등록하고 현재 상태를 즉시 전달한다. */
  public subscribe(listener: DeviceRuntimeListener): Unsubscribe {
    this.#listeners.add(listener)
    listener(this.#snapshot)
    return () => this.#listeners.delete(listener)
  }

  /** Runtime 구독과 polling을 정리한다. transport 자체의 소유권은 composition root에 있다. */
  public dispose(): void {
    this.sensorMonitor.stop()
    this.#unsubscribeConnectionState()
    this.#listeners.clear()
  }

  /** Profile이 허용하는 Slave ID와 baudrate인지 I/O 전에 검사한다. */
  #validateConnectionRequest(
    profile: ReturnType<DeviceCatalog['getProfile']>,
    request: DeviceConnectionRequest,
  ): void {
    if (!Number.isInteger(request.slaveId)
      || request.slaveId < profile.slave.minId
      || request.slaveId > profile.slave.maxId) {
      throw new Error(`Slave ID는 ${profile.slave.minId}~${profile.slave.maxId} 정수여야 합니다.`)
    }
    if (!profile.serial.supportedBaudRates.includes(request.baudRate)) {
      throw new Error(`지원하지 않는 baudrate입니다: ${request.baudRate}`)
    }
  }

  /** 임의 Recipe 실행을 막기 위해 Profile의 measurement allowlist만 polling에 허용한다. */
  #validateMeasurementRecipe(
    profile: ReturnType<DeviceCatalog['getProfile']>,
    measurementRecipeId: string,
  ): void {
    if (!profile.recipes.measurements?.includes(measurementRecipeId)) {
      throw new Error(`Profile이 허용하지 않는 측정 Recipe입니다: ${measurementRecipeId}`)
    }
  }

  /** 연결과 Recipe 전환이 공유하는 SensorMonitor 요청을 한 곳에서 조립한다. */
  #startMeasurement(profileId: string, recipeId: string, slaveId: number): void {
    this.sensorMonitor.start(
      { profileId, recipeId, parameters: Object.freeze({ [STANDARD_DEVICE_ID_PARAMETER]: slaveId }) },
      {
        onMeasurement: (result) => this.#handleMeasurement(result.outputs),
        onError: (error) => this.#handleMeasurementError(error),
      },
    )
  }

  /** 연결 상태를 반영하고 connected 이외 상태에서는 현재 polling session을 폐기한다. */
  #handleConnectionStateChange(event: SerialConnectionStateEvent): void {
    if (event.currentState !== SerialConnectionState.Connected) this.sensorMonitor.stop()
    const connectionError = event.currentState === SerialConnectionState.Disconnected
      || event.currentState === SerialConnectionState.Faulted
      ? (event.error ?? new Error('Serial 장치 연결이 예기치 않게 종료되었습니다.'))
      : this.#snapshot.error
    this.#updateSnapshot({ connectionState: event.currentState, error: connectionError })
  }

  /** 활성 연결의 성공한 측정 결과만 상태에 반영한다. */
  #handleMeasurement(outputs: Readonly<Record<string, RecipeNamedOutput>>): void {
    if (this.#snapshot.connectionState !== SerialConnectionState.Connected) return
    this.#updateSnapshot({ outputs, lastUpdatedAt: new Date(), error: null })
  }

  /** 연결이 유지되는 동안의 측정 오류만 표시하고 monitor의 다음 시도는 유지한다. */
  #handleMeasurementError(error: Error): void {
    if (this.#snapshot.connectionState === SerialConnectionState.Connected) {
      this.#updateSnapshot({ error })
    }
  }

  /** 기존 snapshot의 지정된 field만 교체하고 모든 observer에 같은 객체를 전달한다. */
  #updateSnapshot(changes: Partial<DeviceRuntimeSnapshot>): void {
    this.#snapshot = this.#createSnapshot({ ...this.#snapshot, ...changes })
    for (const listener of this.#listeners) listener(this.#snapshot)
  }

  /** 외부 변경을 막는 얕은 불변 snapshot을 생성한다. outputs는 실행기에서 이미 freeze된다. */
  #createSnapshot(snapshot: DeviceRuntimeSnapshot): DeviceRuntimeSnapshot {
    return Object.freeze(snapshot)
  }

  /** unknown catch 값을 일관된 Error로 변환한다. */
  #toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }
}
