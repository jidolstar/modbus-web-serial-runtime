import { describe, expect, it } from 'vitest'
import { appendModbusCrc } from './crc16'
import { ModbusExceptionError, ModbusValidationError } from './modbus-errors'
import { RtuFrameCodec } from './rtu-frame-codec'

describe('RtuFrameCodec', () => {
  const codec = new RtuFrameCodec()

  it('Slave 100 FC03 요청을 실측 frame과 동일하게 만든다', () => {
    expect([...codec.buildReadHoldingRegistersRequest(100, 0, 2)]).toEqual([
      0x64, 0x03, 0x00, 0x00, 0x00, 0x02, 0xcd, 0xfe,
    ])
  })

  it('FC03 응답을 register 배열로 변환한다', () => {
    const response = new Uint8Array([0x64, 0x03, 0x04, 0x02, 0x11, 0x01, 0x40, 0x9e, 0xe8])
    expect(codec.parseReadHoldingRegistersResponse(response, 100, 2)).toEqual([529, 320])
  })

  it('FC06 echo의 주소와 값을 검증한다', () => {
    const response = codec.buildWriteSingleRegisterRequest(100, 0x07d0, 10)
    expect(() => codec.validateWriteSingleRegisterResponse(response, 100, 0x07d0, 10)).not.toThrow()
  })

  it('Modbus exception code를 구조화된 오류로 전달한다', () => {
    const exceptionResponse = appendModbusCrc(new Uint8Array([0x64, 0x83, 0x02]))
    expect(() => codec.parseReadHoldingRegistersResponse(exceptionResponse, 100, 2))
      .toThrow(ModbusExceptionError)
  })

  it('지원 범위를 벗어난 Slave ID를 전송 전에 거부한다', () => {
    expect(() => codec.buildReadHoldingRegistersRequest(0, 0, 1)).toThrow(ModbusValidationError)
  })
})
