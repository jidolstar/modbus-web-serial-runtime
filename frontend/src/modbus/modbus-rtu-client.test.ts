import { describe, expect, it } from 'vitest'
import { SerialFlowControl, SerialParity, type SerialConfig } from '../serial/serial-types'
import { SerialDisconnectedError } from '../serial/serial-errors'
import { MockSerialTransport } from '../serial/testing/mock-serial-transport'
import { appendModbusCrc } from './crc16'
import { ModbusCrcError, ModbusResponseMismatchError, ModbusTimeoutError } from './modbus-errors'
import { ModbusRtuClient } from './modbus-rtu-client'

/** Client 테스트에서 공통으로 여는 9600/8N1 설정이다. */
const TEST_SERIAL_CONFIG: SerialConfig = Object.freeze({
  baudRate: 9_600,
  dataBits: 8,
  stopBits: 1,
  parity: SerialParity.None,
  flowControl: SerialFlowControl.None,
})

/** CWT 실측값과 같은 FC03 정상 응답이다. */
const READ_RESPONSE = new Uint8Array([0x64, 0x03, 0x04, 0x02, 0x11, 0x01, 0x40, 0x9e, 0xe8])

/** Queue가 비동기 operation을 시작할 때까지 event loop를 진행한다. */
async function flushAsyncWork(): Promise<void> {
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

async function createConnectedClient(): Promise<{
  transport: MockSerialTransport
  client: ModbusRtuClient
}> {
  const transport = new MockSerialTransport()
  await transport.open(TEST_SERIAL_CONFIG)
  return {
    transport,
    client: new ModbusRtuClient(transport, 1_200),
  }
}

describe('ModbusRtuClient', () => {
  it('분리 수신된 FC03 frame을 결합해 register를 반환한다', async () => {
    const { transport, client } = await createConnectedClient()
    const resultPromise = client.readHoldingRegisters(100, 0, 2)
    await flushAsyncWork()

    transport.emitReceivedBytes(READ_RESPONSE.slice(0, 4))
    transport.emitReceivedBytes(READ_RESPONSE.slice(4))

    await expect(resultPromise).resolves.toEqual([529, 320])
    client.dispose()
  })

  it('FC06 요청을 보내고 동일한 echo 응답을 검증한다', async () => {
    const { transport, client } = await createConnectedClient()
    transport.setWriteHandler((requestFrame) => transport.emitReceivedBytes(requestFrame))

    await expect(client.writeSingleRegister(100, 0x07d0, 10)).resolves.toBeUndefined()
    client.dispose()
  })

  it('동시에 등록된 두 요청을 bus에 순차 전송한다', async () => {
    const { transport, client } = await createConnectedClient()
    const firstRequest = client.readHoldingRegisters(100, 0, 2)
    const secondRequest = client.readHoldingRegisters(100, 0, 2)
    await flushAsyncWork()

    expect(transport.writtenFrames).toHaveLength(1)
    transport.emitReceivedBytes(READ_RESPONSE)
    await firstRequest
    await flushAsyncWork()
    expect(transport.writtenFrames).toHaveLength(2)
    transport.emitReceivedBytes(READ_RESPONSE)
    await secondRequest
    client.dispose()
  })

  it('CRC가 손상된 frame을 값으로 반환하지 않는다', async () => {
    const { transport, client } = await createConnectedClient()
    const resultPromise = client.readHoldingRegisters(100, 0, 2)
    await flushAsyncWork()
    const corruptedResponse = READ_RESPONSE.slice()
    corruptedResponse[8] ^= 0xff
    transport.emitReceivedBytes(corruptedResponse)

    await expect(resultPromise).rejects.toBeInstanceOf(ModbusCrcError)
    client.dispose()
  })

  it('응답 대기 중 장치가 분리되면 timeout 전에 즉시 실패한다', async () => {
    const { transport, client } = await createConnectedClient()
    const resultPromise = client.readHoldingRegisters(100, 0, 2)
    await flushAsyncWork()
    transport.simulateDeviceRemoval()

    await expect(resultPromise).rejects.toBeInstanceOf(SerialDisconnectedError)
    client.dispose()
  })

  it('timeout 뒤 늦게 도착한 응답을 다음 transaction 응답으로 사용하지 않는다', async () => {
    const transport = new MockSerialTransport()
    await transport.open(TEST_SERIAL_CONFIG)
    const client = new ModbusRtuClient(transport, 100)

    await expect(client.readHoldingRegisters(100, 0, 2)).rejects.toBeInstanceOf(ModbusTimeoutError)
    transport.emitReceivedBytes(READ_RESPONSE)

    const nextRequest = client.readHoldingRegisters(100, 0, 2)
    await flushAsyncWork()
    transport.emitReceivedBytes(READ_RESPONSE)
    await expect(nextRequest).resolves.toEqual([529, 320])
    client.dispose()
  })

  it('요청과 다른 Function Code 응답을 즉시 거부한다', async () => {
    const { transport, client } = await createConnectedClient()
    const resultPromise = client.readHoldingRegisters(100, 0, 2)
    await flushAsyncWork()
    const wrongFunctionResponse = appendModbusCrc(new Uint8Array([
      0x64, 0x06, 0x00, 0x00, 0x00, 0x02,
    ]))
    transport.emitReceivedBytes(wrongFunctionResponse)

    await expect(resultPromise).rejects.toBeInstanceOf(ModbusResponseMismatchError)
    client.dispose()
  })

  it('FC03 응답 fixture CRC를 재생성할 수 있다', () => {
    const payload = READ_RESPONSE.slice(0, -2)
    expect([...appendModbusCrc(payload)]).toEqual([...READ_RESPONSE])
  })
})
