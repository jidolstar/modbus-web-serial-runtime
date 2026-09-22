import {
  SerialConnectionState,
  SerialDisconnectReason,
  type SerialConnectionStateEvent,
} from '../serial-connection-state'
import { SerialNotConnectedError } from '../serial-errors'
import type { SerialTransport } from '../serial-transport'
import type { SerialConfig, SerialDataListener, Unsubscribe } from '../serial-types'

/** 실제 USB 장비 없이 상위 통신 계층을 검증하기 위한 in-memory transport다. */
export class MockSerialTransport implements SerialTransport {
  readonly #dataListeners = new Set<SerialDataListener>()
  readonly #stateListeners = new Set<(event: SerialConnectionStateEvent) => void>()
  readonly #writtenFrames: Uint8Array[] = []

  #connectionState = SerialConnectionState.Idle
  #lastConfig: SerialConfig | null = null

  /** 테스트가 전송 직후 응답이나 오류를 예약할 수 있게 하는 선택 callback이다. */
  #writeHandler: ((frame: Uint8Array) => void | Promise<void>) | null = null

  public readonly isSupported = true

  public get connectionState(): SerialConnectionState {
    return this.#connectionState
  }

  /** 테스트 중 transport로 전송된 frame의 안전한 복사본이다. */
  public get writtenFrames(): ReadonlyArray<Uint8Array> {
    return this.#writtenFrames.map((frame) => frame.slice())
  }

  public async requestPort(): Promise<void> {
    this.#changeState(SerialConnectionState.RequestingPort)
    this.#changeState(SerialConnectionState.Idle)
  }

  public async open(config: SerialConfig): Promise<void> {
    this.#lastConfig = Object.freeze({ ...config })
    this.#changeState(SerialConnectionState.Opening)
    this.#changeState(SerialConnectionState.Connected)
  }

  public async reconnect(config: SerialConfig | null = this.#lastConfig): Promise<void> {
    if (!config) throw new SerialNotConnectedError('재연결 설정이 없습니다.')
    await this.open(config)
  }

  public async reopen(config: SerialConfig): Promise<void> {
    this.#changeState(SerialConnectionState.Reconfiguring)
    this.#lastConfig = Object.freeze({ ...config })
    this.#changeState(SerialConnectionState.Connected)
  }

  public async close(
    reason: SerialDisconnectReason = SerialDisconnectReason.UserRequested,
  ): Promise<void> {
    this.#changeState(SerialConnectionState.Closing, reason)
    this.#changeState(SerialConnectionState.Idle, reason)
  }

  public async write(data: Uint8Array): Promise<void> {
    if (this.#connectionState !== SerialConnectionState.Connected) {
      throw new SerialNotConnectedError('Mock transport가 연결되지 않았습니다.')
    }
    this.#writtenFrames.push(data.slice())
    await this.#writeHandler?.(data.slice())
  }

  public subscribeData(listener: SerialDataListener): Unsubscribe {
    this.#dataListeners.add(listener)
    return () => this.#dataListeners.delete(listener)
  }

  public subscribeConnectionState(
    listener: (event: SerialConnectionStateEvent) => void,
  ): Unsubscribe {
    this.#stateListeners.add(listener)
    return () => this.#stateListeners.delete(listener)
  }

  public async dispose(): Promise<void> {
    await this.close(SerialDisconnectReason.ApplicationDisposed)
    this.#dataListeners.clear()
    this.#stateListeners.clear()
  }

  /** 테스트 응답을 여러 chunk로 나누어 주입할 때 사용한다. */
  public emitReceivedBytes(bytes: Uint8Array): void {
    for (const listener of this.#dataListeners) listener(bytes.slice())
  }

  /** 예기치 않은 물리 분리를 재현한다. */
  public simulateDeviceRemoval(): void {
    this.#changeState(SerialConnectionState.Disconnected, SerialDisconnectReason.DeviceRemoved)
  }

  /** 전송 frame에 따른 테스트 동작을 등록한다. */
  public setWriteHandler(handler: (frame: Uint8Array) => void | Promise<void>): void {
    this.#writeHandler = handler
  }

  #changeState(nextState: SerialConnectionState, reason?: SerialDisconnectReason): void {
    const previousState = this.#connectionState
    this.#connectionState = nextState
    const event: SerialConnectionStateEvent = Object.freeze({
      previousState,
      currentState: nextState,
      disconnectReason: reason,
    })
    for (const listener of this.#stateListeners) listener(event)
  }
}
