import { appendModbusCrc, hasValidModbusCrc } from './crc16'
import {
  ModbusCrcError,
  ModbusExceptionError,
  ModbusResponseMismatchError,
  ModbusValidationError,
} from './modbus-errors'
import { ModbusFunctionCode } from './modbus-types'

/** Modbus가 개별 Slave 주소로 허용하는 최소값이다. */
const MINIMUM_SLAVE_ID = 1

/** Modbus가 개별 Slave 주소로 허용하는 최대값이다. */
const MAXIMUM_SLAVE_ID = 247

/** 16-bit register 주소와 값이 가질 수 있는 최댓값이다. */
const MAXIMUM_REGISTER_VALUE = 0xffff

/** FC03 한 요청에서 표준상 읽을 수 있는 최대 register 개수다. */
const MAXIMUM_READ_REGISTER_COUNT = 125

/** Modbus exception 여부를 나타내는 Function Code bit mask다. */
export const MODBUS_EXCEPTION_MASK = 0x80

/** Modbus exception frame의 고정 길이다. */
export const MODBUS_EXCEPTION_FRAME_LENGTH = 5

/** FC06 요청과 정상 echo 응답의 고정 길이다. */
export const WRITE_SINGLE_REGISTER_FRAME_LENGTH = 8

/** 일반 read 응답에서 data byte를 제외한 header와 CRC 길이다. */
export const READ_RESPONSE_OVERHEAD_LENGTH = 5

/** RTU 요청 frame을 생성하고 응답 payload를 검증·해석하는 stateless codec이다. */
export class RtuFrameCodec {
  /** FC03 Read Holding Registers 요청 frame을 생성한다. */
  public buildReadHoldingRegistersRequest(slaveId: number, address: number, count: number): Uint8Array {
    this.#validateSlaveId(slaveId)
    this.#validateRegisterValue('address', address)
    if (!Number.isInteger(count) || count < 1 || count > MAXIMUM_READ_REGISTER_COUNT) {
      throw new ModbusValidationError(
        `register count는 1~${MAXIMUM_READ_REGISTER_COUNT} 범위의 정수여야 합니다.`,
      )
    }

    return appendModbusCrc(new Uint8Array([
      slaveId,
      ModbusFunctionCode.ReadHoldingRegisters,
      (address >>> 8) & 0xff,
      address & 0xff,
      (count >>> 8) & 0xff,
      count & 0xff,
    ]))
  }

  /** FC06 Write Single Register 요청 frame을 생성한다. */
  public buildWriteSingleRegisterRequest(slaveId: number, address: number, value: number): Uint8Array {
    this.#validateSlaveId(slaveId)
    this.#validateRegisterValue('address', address)
    this.#validateRegisterValue('value', value)

    return appendModbusCrc(new Uint8Array([
      slaveId,
      ModbusFunctionCode.WriteSingleRegister,
      (address >>> 8) & 0xff,
      address & 0xff,
      (value >>> 8) & 0xff,
      value & 0xff,
    ]))
  }

  /** FC03 응답을 검증하고 16-bit register 배열로 변환한다. */
  public parseReadHoldingRegistersResponse(
    frame: Uint8Array,
    expectedSlaveId: number,
    expectedCount: number,
  ): ReadonlyArray<number> {
    this.#validateCommonResponse(frame, expectedSlaveId, ModbusFunctionCode.ReadHoldingRegisters)

    const expectedByteCount = expectedCount * 2
    const receivedByteCount = frame[2]
    const expectedFrameLength = READ_RESPONSE_OVERHEAD_LENGTH + expectedByteCount
    if (receivedByteCount !== expectedByteCount || frame.length !== expectedFrameLength) {
      throw new ModbusResponseMismatchError(
        `FC03 응답 길이가 요청과 다릅니다. expected bytes=${expectedByteCount}, actual=${receivedByteCount}`,
      )
    }

    const registers: number[] = []
    for (let registerIndex = 0; registerIndex < expectedCount; registerIndex += 1) {
      const highByteIndex = 3 + registerIndex * 2
      registers.push((frame[highByteIndex] << 8) | frame[highByteIndex + 1])
    }
    return Object.freeze(registers)
  }

  /** FC06 echo 응답이 보낸 주소와 값과 정확히 일치하는지 확인한다. */
  public validateWriteSingleRegisterResponse(
    frame: Uint8Array,
    expectedSlaveId: number,
    expectedAddress: number,
    expectedValue: number,
  ): void {
    this.#validateCommonResponse(frame, expectedSlaveId, ModbusFunctionCode.WriteSingleRegister)
    if (frame.length !== WRITE_SINGLE_REGISTER_FRAME_LENGTH) {
      throw new ModbusResponseMismatchError('FC06 응답 frame 길이가 8 bytes가 아닙니다.')
    }

    const receivedAddress = (frame[2] << 8) | frame[3]
    const receivedValue = (frame[4] << 8) | frame[5]
    if (receivedAddress !== expectedAddress || receivedValue !== expectedValue) {
      throw new ModbusResponseMismatchError(
        `FC06 echo가 요청과 다릅니다. address=${receivedAddress}, value=${receivedValue}`,
      )
    }
  }

  /** CRC, Slave ID, Function Code와 exception 응답을 공통 검증한다. */
  #validateCommonResponse(
    frame: Uint8Array,
    expectedSlaveId: number,
    expectedFunctionCode: ModbusFunctionCode,
  ): void {
    if (!hasValidModbusCrc(frame)) throw new ModbusCrcError('수신한 Modbus RTU frame의 CRC가 올바르지 않습니다.')
    if (frame[0] !== expectedSlaveId) {
      throw new ModbusResponseMismatchError(
        `응답 Slave ID가 요청과 다릅니다. expected=${expectedSlaveId}, actual=${frame[0]}`,
      )
    }

    const receivedFunctionCode = frame[1]
    if (receivedFunctionCode === (expectedFunctionCode | MODBUS_EXCEPTION_MASK)) {
      throw new ModbusExceptionError(
        `Slave가 Modbus exception 0x${frame[2].toString(16).padStart(2, '0')}으로 응답했습니다.`,
        frame[2],
      )
    }
    if (receivedFunctionCode !== expectedFunctionCode) {
      throw new ModbusResponseMismatchError(
        `응답 Function Code가 요청과 다릅니다. expected=${expectedFunctionCode}, actual=${receivedFunctionCode}`,
      )
    }
  }

  /** 개별 Slave ID 범위를 확인한다. Broadcast ID 0은 이 client에서 지원하지 않는다. */
  #validateSlaveId(slaveId: number): void {
    if (!Number.isInteger(slaveId) || slaveId < MINIMUM_SLAVE_ID || slaveId > MAXIMUM_SLAVE_ID) {
      throw new ModbusValidationError(
        `Slave ID는 ${MINIMUM_SLAVE_ID}~${MAXIMUM_SLAVE_ID} 범위의 정수여야 합니다.`,
      )
    }
  }

  /** 주소와 register 값이 unsigned 16-bit 범위인지 확인한다. */
  #validateRegisterValue(fieldName: string, value: number): void {
    if (!Number.isInteger(value) || value < 0 || value > MAXIMUM_REGISTER_VALUE) {
      throw new ModbusValidationError(`${fieldName}는 0~${MAXIMUM_REGISTER_VALUE} 범위의 정수여야 합니다.`)
    }
  }
}
