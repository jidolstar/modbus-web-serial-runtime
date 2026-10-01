import { describe, expect, it } from 'vitest'
import { SerialFlowControl, SerialParity } from '../serial/serial-types'
import { modbusRtuInterFrameDelayMs } from './rtu-timing'

describe('modbusRtuInterFrameDelayMs', () => {
  it('4,800bps 8N1의 t3.5를 8ms로 올림한다', () => {
    expect(modbusRtuInterFrameDelayMs({ baudRate: 4_800, dataBits: 8, stopBits: 1, parity: SerialParity.None, flowControl: SerialFlowControl.None })).toBe(8)
  })

  it('9,600bps 8E1의 t3.5를 5ms로 올림한다', () => {
    expect(modbusRtuInterFrameDelayMs({ baudRate: 9_600, dataBits: 8, stopBits: 1, parity: SerialParity.Even, flowControl: SerialFlowControl.None })).toBe(5)
  })

  it('19,200bps를 초과하면 권고 고정값 1.75ms를 2ms로 올림한다', () => {
    expect(modbusRtuInterFrameDelayMs({ baudRate: 115_200, dataBits: 8, stopBits: 1, parity: SerialParity.None, flowControl: SerialFlowControl.None })).toBe(2)
  })
})
