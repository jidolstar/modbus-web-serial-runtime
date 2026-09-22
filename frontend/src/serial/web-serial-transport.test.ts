import { describe, expect, it } from 'vitest'
import { SerialConnectionState, SerialDisconnectReason } from './serial-connection-state'
import { SerialFlowControl, SerialParity, type SerialConfig } from './serial-types'
import type { BrowserSerialApi, BrowserSerialPort, WebSerialEnvironment } from './web-serial-api.types'
import { WebSerialTransport } from './web-serial-transport'

/** WebSerialTransport 테스트에 사용하는 대표 9600/8N1 설정이다. */
const TEST_SERIAL_CONFIG: SerialConfig = Object.freeze({
  baudRate: 9_600,
  dataBits: 8,
  stopBits: 1,
  parity: SerialParity.None,
  flowControl: SerialFlowControl.None,
})

/** Web Serial stream을 메모리에서 재현하는 최소 fake port다. */
class FakeBrowserSerialPort extends EventTarget implements BrowserSerialPort {
  public readable: ReadableStream<Uint8Array> | null = null
  public writable: WritableStream<Uint8Array> | null = null

  /** 테스트가 수신 byte를 stream에 넣을 때 사용하는 controller다. */
  #readController: ReadableStreamDefaultController<Uint8Array> | null = null

  /** transport가 전송한 byte의 복사본이다. */
  readonly writtenFrames: Uint8Array[] = []

  public async open(_config: SerialConfig): Promise<void> {
    this.readable = new ReadableStream<Uint8Array>({
      start: (controller) => {
        this.#readController = controller
      },
    })
    this.writable = new WritableStream<Uint8Array>({
      write: (frame) => {
        this.writtenFrames.push(frame.slice())
      },
    })
  }

  public async close(): Promise<void> {
    try {
      this.#readController?.close()
    } catch {
      // reader.cancel()이 먼저 실행되면 stream은 이미 닫혀 있으므로 추가 close가 필요 없다.
    }
    this.#readController = null
    this.readable = null
    this.writable = null
  }

  /** read loop에 장비 응답 chunk를 전달한다. */
  public emitBytes(bytes: Uint8Array): void {
    this.#readController?.enqueue(bytes.slice())
  }
}

/** requestPort와 disconnect event를 제어할 수 있는 fake Serial API다. */
class FakeBrowserSerialApi extends EventTarget implements BrowserSerialApi {
  public constructor(public readonly port: FakeBrowserSerialPort) {
    super()
  }

  public async requestPort(): Promise<BrowserSerialPort> {
    return this.port
  }

  public async getPorts(): Promise<BrowserSerialPort[]> {
    return [this.port]
  }

  /** 실제 SerialConnectionEvent처럼 분리된 port를 event에 포함한다. */
  public emitDeviceRemoved(): void {
    const disconnectEvent = new Event('disconnect') as Event & { port?: BrowserSerialPort }
    Object.defineProperty(disconnectEvent, 'port', { value: this.port })
    this.dispatchEvent(disconnectEvent)
  }
}

/** Promise queue에 등록된 transport callback이 실행될 기회를 제공한다. */
async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

describe('WebSerialTransport', () => {
  it('Web Serial resource를 숨기고 수신 byte만 구독자에게 전달한다', async () => {
    const port = new FakeBrowserSerialPort()
    const serialApi = new FakeBrowserSerialApi(port)
    const transport = new WebSerialTransport({ serial: serialApi } satisfies WebSerialEnvironment)
    const receivedChunks: Uint8Array[] = []
    transport.subscribeData((bytes) => receivedChunks.push(bytes.slice()))

    await transport.requestPort()
    await transport.open(TEST_SERIAL_CONFIG)
    port.emitBytes(new Uint8Array([0x64, 0x03]))
    await flushAsyncWork()

    expect(transport.connectionState).toBe(SerialConnectionState.Connected)
    expect([...receivedChunks[0]]).toEqual([0x64, 0x03])
    await transport.dispose()
  })

  it('물리 분리를 device-removed 상태로 한 번만 알린다', async () => {
    const port = new FakeBrowserSerialPort()
    const serialApi = new FakeBrowserSerialApi(port)
    const transport = new WebSerialTransport({ serial: serialApi } satisfies WebSerialEnvironment)
    const disconnectReasons: SerialDisconnectReason[] = []
    transport.subscribeConnectionState((event) => {
      if (event.disconnectReason) disconnectReasons.push(event.disconnectReason)
    })

    await transport.requestPort()
    await transport.open(TEST_SERIAL_CONFIG)
    serialApi.emitDeviceRemoved()
    serialApi.emitDeviceRemoved()
    await flushAsyncWork()

    expect(transport.connectionState).toBe(SerialConnectionState.Disconnected)
    expect(disconnectReasons.filter((reason) => reason === SerialDisconnectReason.DeviceRemoved)).toHaveLength(1)
    await transport.dispose()
  })

  it('사용자 close는 fault가 아니라 idle 상태로 종료한다', async () => {
    const port = new FakeBrowserSerialPort()
    const serialApi = new FakeBrowserSerialApi(port)
    const transport = new WebSerialTransport({ serial: serialApi } satisfies WebSerialEnvironment)

    await transport.requestPort()
    await transport.open(TEST_SERIAL_CONFIG)
    await transport.close(SerialDisconnectReason.UserRequested)

    expect(transport.connectionState).toBe(SerialConnectionState.Idle)
    await transport.dispose()
  })
})
