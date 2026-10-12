import type { SerialConfig } from '../serial/serial-types'

const HIGH_BAUD_RATE_THRESHOLD = 19_200
const HIGH_BAUD_RATE_INTER_FRAME_DELAY_US = 1_750
const MODBUS_RTU_SILENT_CHARACTERS = 3.5
const INTER_FRAME_DELAY_MULTIPLIER = 4 // 간헐적 응답 누락을 줄이기 위해 공식 최소 간격을 4배 적용한다. 예: 8ms → 32ms

/**
 * Test Group의 연속 요청 사이에 둘 무통신 시간을 millisecond 정수로 반환한다.
 * 19,200bps 이하는 실제 character 길이의 t3.5를 계산하고, 더 빠른 baudrate는 공식 1.75ms 권고값을 사용한 뒤 모두 4배로 늘린다.
 */
export function modbusRtuInterFrameDelayMs(config: SerialConfig): number {
  if (config.baudRate > HIGH_BAUD_RATE_THRESHOLD) {
    return Math.ceil(HIGH_BAUD_RATE_INTER_FRAME_DELAY_US / 1_000) * INTER_FRAME_DELAY_MULTIPLIER
  }

  const parityBits = config.parity === 'none' ? 0 : 1
  const bitsPerCharacter = 1 + config.dataBits + parityBits + config.stopBits
  const delayMs = MODBUS_RTU_SILENT_CHARACTERS * bitsPerCharacter * 1_000 / config.baudRate
  return Math.ceil(delayMs) * INTER_FRAME_DELAY_MULTIPLIER
}
