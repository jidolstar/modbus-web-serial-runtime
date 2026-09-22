import { describe, expect, it } from 'vitest'
import { SerialConnectionState, SerialDisconnectReason } from '../serial-connection-state'
import { SerialFlowControl, SerialParity, type SerialConfig } from '../serial-types'
import { MockSerialTransport } from './mock-serial-transport'

/** Mock transport 상태 전이에 사용하는 대표 9600/8N1 설정이다. */
const TEST_SERIAL_CONFIG: SerialConfig = Object.freeze({
  baudRate: 9_600,
  dataBits: 8,
  stopBits: 1,
  parity: SerialParity.None,
  flowControl: SerialFlowControl.None,
})

describe('MockSerialTransport', () => {
  it('연결된 상태에서 전송 frame의 복사본을 기록한다', async () => {
    const transport = new MockSerialTransport()
    await transport.open(TEST_SERIAL_CONFIG)

    const requestFrame = new Uint8Array([0x64, 0x03])
    await transport.write(requestFrame)
    requestFrame[0] = 0

    expect([...transport.writtenFrames[0]]).toEqual([0x64, 0x03])
  })

  it('물리 분리를 사용자 해제와 다른 상태 및 사유로 알린다', () => {
    const transport = new MockSerialTransport()
    const observedReasons: Array<SerialDisconnectReason | undefined> = []
    transport.subscribeConnectionState((event) => observedReasons.push(event.disconnectReason))

    transport.simulateDeviceRemoval()

    expect(transport.connectionState).toBe(SerialConnectionState.Disconnected)
    expect(observedReasons.at(-1)).toBe(SerialDisconnectReason.DeviceRemoved)
  })

  it('사용자 close는 idle 상태로 정상 종료한다', async () => {
    const transport = new MockSerialTransport()
    await transport.open(TEST_SERIAL_CONFIG)
    await transport.close(SerialDisconnectReason.UserRequested)

    expect(transport.connectionState).toBe(SerialConnectionState.Idle)
  })
})
