import type { SerialConfig } from '../serial/serial-types'

const HIGH_BAUD_RATE_THRESHOLD = 19_200
const HIGH_BAUD_RATE_INTER_FRAME_DELAY_US = 1_750
const MODBUS_RTU_SILENT_CHARACTERS = 3.5

/**
 * 두 Modbus RTU frame 사이에 보장할 최소 무통신 시간을 millisecond 정수로 반환한다.
 * 19,200bps 이하는 실제 character 길이의 t3.5를 계산하고, 그보다 빠르면 공식 가이드의 1.75ms 권고값을 올림한다.
 */
export function modbusRtuInterFrameDelayMs(config: SerialConfig): number {
  if (config.baudRate > HIGH_BAUD_RATE_THRESHOLD) return Math.ceil(HIGH_BAUD_RATE_INTER_FRAME_DELAY_US / 1_000)

  const parityBits = config.parity === 'none' ? 0 : 1
  const bitsPerCharacter = 1 + config.dataBits + parityBits + config.stopBits
  const delayMs = MODBUS_RTU_SILENT_CHARACTERS * bitsPerCharacter * 1_000 / config.baudRate
  return Math.ceil(delayMs)
}
