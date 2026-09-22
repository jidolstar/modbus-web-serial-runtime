import {
  SerialConnectionState,
  SerialDisconnectReason,
  type SerialConnectionStateEvent,
} from './serial-connection-state'
import {
  SerialDisconnectedError,
  SerialNotConnectedError,
  SerialWriteError,
} from './serial-errors'
import type { SerialTransport } from './serial-transport'
import type { SerialConfig, SerialDataListener, Unsubscribe } from './serial-types'
import type {
  BrowserSerialApi,
  BrowserSerialPort,
  WebSerialEnvironment,
} from './web-serial-api.types'

/**
 * Web Serial API의 port, stream lock, disconnect event를 캡슐화한다.
 *
 * 이 클래스 밖에서는 navigator.serial, reader, writer를 직접 다루지 않는다.
 */
export class WebSerialTransport implements SerialTransport {
  /** 브라우저가 제공한 Web Serial API다. 미지원 환경에서는 undefined다. */
  readonly #serialApi: BrowserSerialApi | undefined

  /** 수신 byte를 전달할 구독자 모음이다. */
  readonly #dataListeners = new Set<SerialDataListener>()

  /** 연결 상태 변화를 전달할 구독자 모음이다. */
  readonly #stateListeners = new Set<(event: SerialConnectionStateEvent) => void>()

  /** 현재 선택되어 있거나 재연결에 사용할 browser port다. */
  #port: BrowserSerialPort | null = null

  /** 현재 read loop가 소유한 stream reader다. */
  #reader: ReadableStreamDefaultReader<Uint8Array> | null = null

  /** read loop 종료를 기다릴 때 사용하는 Promise다. */
  #readLoopPromise: Promise<void> | null = null

  /** 마지막으로 성공적으로 port를 열 때 사용한 설정이다. */
  #lastConfig: SerialConfig | null = null

  /** 현재 외부에 공개되는 연결 상태다. */
  #connectionState = SerialConnectionState.Idle

  /** 중복 disconnect 신호가 같은 resource를 두 번 정리하지 못하게 하는 Promise다. */
  #cleanupPromise: Promise<void> | null = null

  /** 이전 연결의 늦은 async callback을 무시하기 위한 증가 번호다. */
  #connectionGeneration = 0

  /** dispose 이후 public method 사용을 막기 위한 flag다. */
  #isDisposed = false

  /** EventTarget에서 제거할 수 있도록 동일한 함수 참조를 유지한다. */
  readonly #browserDisconnectListener = (event: Event): void => {
    // Web Serial의 SerialConnectionEvent는 실제 분리된 port를 port 속성으로 제공한다.
    const disconnectedPort = (event as Event & { readonly port?: BrowserSerialPort }).port
    if (disconnectedPort !== this.#port) return
    void this.#terminateUnexpectedly(SerialDisconnectReason.DeviceRemoved)
  }

  public constructor(
    serialEnvironment: WebSerialEnvironment = navigator as Navigator & WebSerialEnvironment,
  ) {
    this.#serialApi = serialEnvironment.serial
    this.#serialApi?.addEventListener('disconnect', this.#browserDisconnectListener)
  }

  public get connectionState(): SerialConnectionState {
    return this.#connectionState
  }

  public get isSupported(): boolean {
    return this.#serialApi !== undefined
  }

  public async requestPort(): Promise<void> {
    this.#assertUsable()
    if (!this.#serialApi) throw new SerialNotConnectedError('이 브라우저는 Web Serial을 지원하지 않습니다.')

    this.#transitionTo(SerialConnectionState.RequestingPort)
    try {
      this.#port = await this.#serialApi.requestPort()
      this.#transitionTo(SerialConnectionState.Idle)
    } catch (error) {
      this.#transitionTo(SerialConnectionState.Idle)
      throw error
    }
  }

  public async open(config: SerialConfig): Promise<void> {
    this.#assertUsable()
    if (!this.#port) throw new SerialNotConnectedError('먼저 사용할 Serial Port를 선택해야 합니다.')
    if (this.#connectionState === SerialConnectionState.Connected) return

    this.#transitionTo(SerialConnectionState.Opening)
    try {
      await this.#port.open(config)
      this.#lastConfig = Object.freeze({ ...config })
      this.#startReadLoop()
      this.#transitionTo(SerialConnectionState.Connected)
    } catch (error) {
      this.#transitionTo(SerialConnectionState.Faulted, undefined, this.#toError(error))
      throw error
    }
  }

  public async reconnect(config: SerialConfig | null = this.#lastConfig): Promise<void> {
    this.#assertUsable()
    if (!config) throw new SerialNotConnectedError('재연결에 사용할 이전 Serial 설정이 없습니다.')
    await this.open(config)
  }

  public async reopen(config: SerialConfig): Promise<void> {
    this.#assertUsable()
    if (!this.#port) throw new SerialNotConnectedError('다시 열 Serial Port가 없습니다.')

    this.#transitionTo(SerialConnectionState.Reconfiguring)
    this.#connectionGeneration += 1
    await this.#stopReadLoop()
    await this.#closeBrowserPort()

    try {
      await this.#port.open(config)
      this.#lastConfig = Object.freeze({ ...config })
      this.#startReadLoop()
      this.#transitionTo(SerialConnectionState.Connected)
    } catch (error) {
      this.#transitionTo(SerialConnectionState.Faulted, undefined, this.#toError(error))
      throw error
    }
  }

  public async close(
    reason: SerialDisconnectReason = SerialDisconnectReason.UserRequested,
  ): Promise<void> {
    const targetState = reason === SerialDisconnectReason.UserRequested
      || reason === SerialDisconnectReason.ApplicationDisposed
      ? SerialConnectionState.Idle
      : SerialConnectionState.Disconnected

    await this.#terminateConnection(reason, targetState)
  }

  public async write(data: Uint8Array): Promise<void> {
    this.#assertUsable()
    if (this.#connectionState !== SerialConnectionState.Connected || !this.#port?.writable) {
      throw new SerialNotConnectedError('열린 Serial Port가 없어 데이터를 전송할 수 없습니다.')
    }

    /** write 완료 전에 연결이 교체됐는지 판별하기 위한 현재 연결 번호다. */
    const writeGeneration = this.#connectionGeneration
    const writer = this.#port.writable.getWriter()

    try {
      await writer.write(data)
      if (writeGeneration !== this.#connectionGeneration) {
        throw new SerialDisconnectedError(
          '전송 중 Serial 연결이 변경되었습니다.',
          SerialDisconnectReason.WriteFailure,
        )
      }
    } catch (error) {
      const serialError = error instanceof SerialDisconnectedError
        ? error
        : new SerialWriteError('Serial 데이터 전송에 실패했습니다.', { cause: error })
      await this.#terminateUnexpectedly(SerialDisconnectReason.WriteFailure, serialError)
      throw serialError
    } finally {
      writer.releaseLock()
    }
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
    if (this.#isDisposed) return
    await this.close(SerialDisconnectReason.ApplicationDisposed)
    this.#serialApi?.removeEventListener('disconnect', this.#browserDisconnectListener)
    this.#dataListeners.clear()
    this.#stateListeners.clear()
    this.#port = null
    this.#isDisposed = true
  }

  /** 새 연결 번호로 read loop를 시작한다. */
  #startReadLoop(): void {
    if (!this.#port?.readable) throw new SerialNotConnectedError('Serial readable stream이 없습니다.')

    this.#connectionGeneration += 1
    const readGeneration = this.#connectionGeneration
    const activeReader = this.#port.readable.getReader()
    this.#reader = activeReader
    this.#readLoopPromise = this.#runReadLoop(activeReader, readGeneration)
  }

  /**
   * 수신 stream을 지속해서 읽고 현재 연결 세대의 byte만 전달한다.
   * 이전 연결의 callback은 generation 비교에서 폐기된다.
   */
  async #runReadLoop(
    activeReader: ReadableStreamDefaultReader<Uint8Array>,
    readGeneration: number,
  ): Promise<void> {
    let readFailure: Error | null = null

    try {
      while (readGeneration === this.#connectionGeneration) {
        const { value: receivedBytes, done: streamEnded } = await activeReader.read()
        if (streamEnded) break
        if (!receivedBytes?.length || readGeneration !== this.#connectionGeneration) continue

        for (const listener of this.#dataListeners) listener(receivedBytes)
      }
    } catch (error) {
      if (readGeneration === this.#connectionGeneration) readFailure = this.#toError(error)
    } finally {
      activeReader.releaseLock()
      if (this.#reader === activeReader) this.#reader = null
    }

    if (readGeneration !== this.#connectionGeneration) return

    const disconnectError = readFailure ?? new Error('Serial 수신 stream이 예기치 않게 종료되었습니다.')
    void this.#terminateUnexpectedly(SerialDisconnectReason.ReadFailure, disconnectError)
  }

  /** 사용자 close와 장애 종료가 공유하는 단일 정리 경로다. */
  async #terminateConnection(
    reason: SerialDisconnectReason,
    targetState: SerialConnectionState,
    error?: Error,
  ): Promise<void> {
    if (this.#cleanupPromise) return this.#cleanupPromise

    this.#cleanupPromise = (async () => {
      if (targetState === SerialConnectionState.Idle) {
        this.#transitionTo(SerialConnectionState.Closing, reason)
      }

      this.#connectionGeneration += 1
      await this.#stopReadLoop()
      await this.#closeBrowserPort()
      this.#transitionTo(targetState, reason, error)
    })()

    try {
      await this.#cleanupPromise
    } finally {
      this.#cleanupPromise = null
    }
  }

  /** 예상하지 못한 종료를 일관된 disconnected/faulted 상태로 변환한다. */
  async #terminateUnexpectedly(reason: SerialDisconnectReason, error?: Error): Promise<void> {
    const targetState = reason === SerialDisconnectReason.DeviceRemoved
      ? SerialConnectionState.Disconnected
      : SerialConnectionState.Faulted
    await this.#terminateConnection(reason, targetState, error)
  }

  /** read() 대기를 취소하고 loop가 lock을 해제할 때까지 기다린다. */
  async #stopReadLoop(): Promise<void> {
    const activeReader = this.#reader
    const activeReadLoop = this.#readLoopPromise
    this.#readLoopPromise = null

    if (activeReader) {
      try {
        await activeReader.cancel()
      } catch {
        // 물리적으로 분리된 port는 cancel 자체가 실패할 수 있으며 이미 종료 목적은 달성됐다.
      }
    }

    if (activeReadLoop) {
      try {
        await activeReadLoop
      } catch {
        // read loop의 실제 장애는 connection state event로 전달하므로 정리 단계에서는 재전파하지 않는다.
      }
    }
  }

  /** stream lock이 해제된 port를 닫는다. 이미 분리된 port의 close 실패는 무시한다. */
  async #closeBrowserPort(): Promise<void> {
    if (!this.#port) return
    try {
      await this.#port.close()
    } catch {
      // USB 분리 직후에는 browser가 먼저 port를 닫을 수 있으므로 cleanup은 계속 진행한다.
    }
  }

  /** 상태를 변경하고 등록된 모든 observer에게 동일한 event를 전달한다. */
  #transitionTo(
    nextState: SerialConnectionState,
    disconnectReason?: SerialDisconnectReason,
    error?: Error,
  ): void {
    const previousState = this.#connectionState
    if (previousState === nextState && disconnectReason === undefined && error === undefined) return

    this.#connectionState = nextState
    const stateEvent: SerialConnectionStateEvent = Object.freeze({
      previousState,
      currentState: nextState,
      disconnectReason,
      error,
    })
    for (const listener of this.#stateListeners) listener(stateEvent)
  }

  /** dispose된 instance의 재사용을 명확한 오류로 차단한다. */
  #assertUsable(): void {
    if (this.#isDisposed) throw new SerialNotConnectedError('이미 폐기된 Serial transport입니다.')
  }

  /** unknown catch 값을 Error로 정규화한다. */
  #toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }
}
