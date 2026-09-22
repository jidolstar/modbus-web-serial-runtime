import type { SerialConnectionStateEvent } from '../serial/serial-connection-state'
import { SerialConnectionState, SerialDisconnectReason } from '../serial/serial-connection-state'
import { SerialDisconnectedError } from '../serial/serial-errors'
import type { SerialTransport } from '../serial/serial-transport'
import type { Unsubscribe } from '../serial/serial-types'
import { hasValidModbusCrc } from './crc16'
import {
  ModbusCrcError,
  ModbusResponseMismatchError,
  ModbusTimeoutError,
} from './modbus-errors'
import {
  MODBUS_EXCEPTION_FRAME_LENGTH,
  MODBUS_EXCEPTION_MASK,
  READ_RESPONSE_OVERHEAD_LENGTH,
  RtuFrameCodec,
  WRITE_SINGLE_REGISTER_FRAME_LENGTH,
} from './rtu-frame-codec'
import { SerialTransactionQueue } from './serial-transaction-queue'
import {
  ModbusFrameDirection,
  ModbusFunctionCode,
  type ModbusClient,
  type ModbusFrameEvent,
  type ModbusTransactionOptions,
} from './modbus-types'

/** transaction timeout으로 허용하는 최소값이다. */
const MINIMUM_TRANSACTION_TIMEOUT_MS = 100

/** transaction timeout으로 허용하는 최대값이다. */
const MAXIMUM_TRANSACTION_TIMEOUT_MS = 60_000

/** pending 요청 하나를 완료하기 위해 필요한 frame 식별 정보와 callback이다. */
interface PendingTransaction {
  readonly slaveId: number
  readonly functionCode: ModbusFunctionCode
  readonly resolve: (frame: Uint8Array) => void
  readonly reject: (error: Error) => void
  readonly timeoutId: ReturnType<typeof setTimeout>
}

/**
 * SerialTransport 위에서 Modbus RTU 요청/응답 transaction을 수행한다.
 *
 * RX buffer, pending 요청과 queue는 모두 이 클래스 내부에 은닉된다.
 */
export class ModbusRtuClient implements ModbusClient {
  readonly #frameCodec = new RtuFrameCodec()
  readonly #transactionQueue = new SerialTransactionQueue()
  readonly #frameListeners = new Set<(event: ModbusFrameEvent) => void>()
  readonly #unsubscribeData: Unsubscribe
  readonly #unsubscribeConnectionState: Unsubscribe

  /** 여러 Serial chunk를 완전한 RTU frame으로 합치는 buffer다. */
  #receiveBuffer = new Uint8Array()

  /** Queue에서 현재 실행 중인 유일한 transaction이다. */
  #pendingTransaction: PendingTransaction | null = null

  /** dispose 이후 새로운 요청을 차단하는 flag다. */
  #isDisposed = false

  public constructor(
    private readonly transport: SerialTransport,
    private readonly defaultTimeoutMs: number,
  ) {
    this.#validateTimeout(defaultTimeoutMs)
    this.#unsubscribeData = transport.subscribeData((bytes) => this.#handleReceivedBytes(bytes))
    this.#unsubscribeConnectionState = transport.subscribeConnectionState(
      (event) => this.#handleConnectionStateChange(event),
    )
  }

  public readHoldingRegisters(
    slaveId: number,
    address: number,
    count: number,
    options?: ModbusTransactionOptions,
  ): Promise<ReadonlyArray<number>> {
    const requestFrame = this.#frameCodec.buildReadHoldingRegistersRequest(slaveId, address, count)
    return this.#transactionQueue.enqueue(async () => {
      const responseFrame = await this.#executeTransaction(
        requestFrame,
        slaveId,
        ModbusFunctionCode.ReadHoldingRegisters,
        options?.timeoutMs,
      )
      return this.#frameCodec.parseReadHoldingRegistersResponse(responseFrame, slaveId, count)
    })
  }

  public writeSingleRegister(
    slaveId: number,
    address: number,
    value: number,
    options?: ModbusTransactionOptions,
  ): Promise<void> {
    const requestFrame = this.#frameCodec.buildWriteSingleRegisterRequest(slaveId, address, value)
    return this.#transactionQueue.enqueue(async () => {
      const responseFrame = await this.#executeTransaction(
        requestFrame,
        slaveId,
        ModbusFunctionCode.WriteSingleRegister,
        options?.timeoutMs,
      )
      this.#frameCodec.validateWriteSingleRegisterResponse(responseFrame, slaveId, address, value)
    })
  }

  /** raw TX/RX frame observer를 등록한다. 반환 함수로 구독을 해제한다. */
  public subscribeFrames(listener: (event: ModbusFrameEvent) => void): Unsubscribe {
    this.#frameListeners.add(listener)
    return () => this.#frameListeners.delete(listener)
  }

  /** 구독과 pending 작업을 정리하고 더 이상 이 client를 사용하지 않게 한다. */
  public dispose(): void {
    if (this.#isDisposed) return
    this.#isDisposed = true
    const disposeError = new SerialDisconnectedError(
      'Modbus client가 종료되었습니다.',
      SerialDisconnectReason.ApplicationDisposed,
    )
    this.#rejectPending(disposeError)
    this.#transactionQueue.invalidate(disposeError)
    this.#unsubscribeData()
    this.#unsubscribeConnectionState()
    this.#frameListeners.clear()
  }

  /** Queue 안에서 요청 frame을 쓰고 완전한 응답 하나를 기다린다. */
  async #executeTransaction(
    requestFrame: Uint8Array,
    slaveId: number,
    functionCode: ModbusFunctionCode,
    requestedTimeoutMs?: number,
  ): Promise<Uint8Array> {
    if (this.#isDisposed) throw new Error('종료된 Modbus client는 사용할 수 없습니다.')
    if (this.transport.connectionState !== SerialConnectionState.Connected) {
      throw new SerialDisconnectedError(
        'Serial Port가 연결되지 않아 Modbus 요청을 보낼 수 없습니다.',
        SerialDisconnectReason.ReadFailure,
      )
    }

    const transactionTimeoutMs = requestedTimeoutMs ?? this.defaultTimeoutMs
    this.#validateTimeout(transactionTimeoutMs)
    this.#receiveBuffer = new Uint8Array()

    const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
      const timeoutId = globalThis.setTimeout(() => {
        this.#pendingTransaction = null
        this.#receiveBuffer = new Uint8Array()
        reject(new ModbusTimeoutError(`${transactionTimeoutMs}ms 안에 Modbus 응답을 받지 못했습니다.`))
      }, transactionTimeoutMs)
      this.#pendingTransaction = { slaveId, functionCode, resolve, reject, timeoutId }
    })

    this.#emitFrame(ModbusFrameDirection.Transmit, requestFrame)
    try {
      await this.transport.write(requestFrame)
    } catch (error) {
      this.#rejectPending(error instanceof Error ? error : new Error(String(error)))
    }

    return responsePromise
  }

  /** transport chunk를 buffer에 추가하고 현재 transaction의 frame 길이를 판별한다. */
  #handleReceivedBytes(receivedBytes: Uint8Array): void {
    if (!this.#pendingTransaction) return
    this.#receiveBuffer = this.#appendBytes(this.#receiveBuffer, receivedBytes)

    while (this.#receiveBuffer.length > 0 && this.#receiveBuffer[0] !== this.#pendingTransaction.slaveId) {
      this.#receiveBuffer = this.#receiveBuffer.slice(1)
    }
    if (this.#receiveBuffer.length < 2) return

    const receivedFunctionCode = this.#receiveBuffer[1]
    const isExceptionResponse = receivedFunctionCode
      === (this.#pendingTransaction.functionCode | MODBUS_EXCEPTION_MASK)

    if (receivedFunctionCode !== this.#pendingTransaction.functionCode && !isExceptionResponse) {
      this.#rejectPending(new ModbusResponseMismatchError(
        `응답 Function Code가 요청과 다릅니다. expected=${this.#pendingTransaction.functionCode}, actual=${receivedFunctionCode}`,
      ))
      return
    }

    let expectedFrameLength: number

    if (isExceptionResponse) {
      expectedFrameLength = MODBUS_EXCEPTION_FRAME_LENGTH
    } else if (this.#pendingTransaction.functionCode === ModbusFunctionCode.WriteSingleRegister) {
      expectedFrameLength = WRITE_SINGLE_REGISTER_FRAME_LENGTH
    } else {
      if (this.#receiveBuffer.length < 3) return
      expectedFrameLength = READ_RESPONSE_OVERHEAD_LENGTH + this.#receiveBuffer[2]
    }

    if (this.#receiveBuffer.length < expectedFrameLength) return
    const completeFrame = this.#receiveBuffer.slice(0, expectedFrameLength)
    this.#receiveBuffer = this.#receiveBuffer.slice(expectedFrameLength)

    if (!hasValidModbusCrc(completeFrame)) {
      this.#rejectPending(new ModbusCrcError('수신한 Modbus RTU frame의 CRC가 올바르지 않습니다.'))
      return
    }

    const completedTransaction = this.#pendingTransaction
    this.#pendingTransaction = null
    globalThis.clearTimeout(completedTransaction.timeoutId)
    this.#emitFrame(ModbusFrameDirection.Receive, completeFrame)
    completedTransaction.resolve(completeFrame)
  }

  /** 연결이 connected 상태를 벗어나면 pending과 queued transaction을 같은 오류로 종료한다. */
  #handleConnectionStateChange(event: SerialConnectionStateEvent): void {
    if (event.currentState === SerialConnectionState.Connected) return
    if (!this.#pendingTransaction && event.currentState !== SerialConnectionState.Disconnected
      && event.currentState !== SerialConnectionState.Faulted) return

    const disconnectError = new SerialDisconnectedError(
      event.error?.message ?? 'Serial 연결이 종료되어 Modbus transaction을 중단했습니다.',
      event.disconnectReason ?? SerialDisconnectReason.ReadFailure,
      event.error ? { cause: event.error } : undefined,
    )
    this.#rejectPending(disconnectError)
    this.#transactionQueue.invalidate(disconnectError)
  }

  /** pending transaction을 한 번만 reject하고 관련 timer/buffer를 정리한다. */
  #rejectPending(error: Error): void {
    if (!this.#pendingTransaction) return
    const rejectedTransaction = this.#pendingTransaction
    this.#pendingTransaction = null
    globalThis.clearTimeout(rejectedTransaction.timeoutId)
    this.#receiveBuffer = new Uint8Array()
    rejectedTransaction.reject(error)
  }

  /** 두 byte 배열을 순서를 유지해 새 배열로 결합한다. */
  #appendBytes(existingBytes: Uint8Array, receivedBytes: Uint8Array): Uint8Array {
    const combinedBytes = new Uint8Array(existingBytes.length + receivedBytes.length)
    combinedBytes.set(existingBytes)
    combinedBytes.set(receivedBytes, existingBytes.length)
    return combinedBytes
  }

  /** UI monitor용 raw frame event를 안전한 복사본으로 전달한다. */
  #emitFrame(direction: ModbusFrameDirection, frame: Uint8Array): void {
    const frameEvent: ModbusFrameEvent = Object.freeze({
      direction,
      frame: frame.slice(),
      timestamp: new Date(),
    })
    for (const listener of this.#frameListeners) listener(frameEvent)
  }

  /** timeout 값이 현장 사용에 합리적인 정수 범위인지 확인한다. */
  #validateTimeout(timeoutMs: number): void {
    if (!Number.isInteger(timeoutMs)
      || timeoutMs < MINIMUM_TRANSACTION_TIMEOUT_MS
      || timeoutMs > MAXIMUM_TRANSACTION_TIMEOUT_MS) {
      throw new Error(
        `Modbus timeout은 ${MINIMUM_TRANSACTION_TIMEOUT_MS}~${MAXIMUM_TRANSACTION_TIMEOUT_MS}ms 범위여야 합니다.`,
      )
    }
  }
}
