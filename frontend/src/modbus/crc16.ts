/** Modbus RTU CRC16 계산을 시작할 때 사용하는 표준 초기값이다. */
const MODBUS_CRC_INITIAL_VALUE = 0xffff

/** Modbus RTU CRC16에 사용하는 역방향 다항식이다. */
const MODBUS_CRC_POLYNOMIAL = 0xa001

/** CRC 계산에서 byte 하나를 순회할 때 확인하는 bit 수다. */
const BITS_PER_BYTE = 8

/** Modbus RTU 표준 CRC16 값을 계산하는 순수 함수다. */
export function calculateModbusCrc16(data: Uint8Array): number {
  let currentCrc = MODBUS_CRC_INITIAL_VALUE

  for (const currentByte of data) {
    currentCrc ^= currentByte
    for (let currentBitIndex = 0; currentBitIndex < BITS_PER_BYTE; currentBitIndex += 1) {
      const leastSignificantBitIsSet = (currentCrc & 1) !== 0
      currentCrc = leastSignificantBitIsSet
        ? (currentCrc >>> 1) ^ MODBUS_CRC_POLYNOMIAL
        : currentCrc >>> 1
    }
  }

  return currentCrc
}

/** payload 뒤에 low-byte-first 순서로 CRC를 추가한다. */
export function appendModbusCrc(payload: Uint8Array): Uint8Array {
  const calculatedCrc = calculateModbusCrc16(payload)
  return new Uint8Array([
    ...payload,
    calculatedCrc & 0xff,
    (calculatedCrc >>> 8) & 0xff,
  ])
}

/** 완성된 RTU frame의 CRC가 올바른지 확인한다. */
export function hasValidModbusCrc(frame: Uint8Array): boolean {
  if (frame.length < 4) return false

  // RTU frame은 CRC low byte를 먼저 전송하므로 little-endian 순서로 합친다.
  const receivedCrc = frame[frame.length - 2] | (frame[frame.length - 1] << 8)
  return calculateModbusCrc16(frame.subarray(0, -2)) === receivedCrc
}
