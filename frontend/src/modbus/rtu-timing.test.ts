import { describe, expect, it } from 'vitest'
import { SerialFlowControl, SerialParity } from '../serial/serial-types'
import { modbusRtuInterFrameDelayMs } from './rtu-timing'

describe('modbusRtuInterFrameDelayMs', () => {
  it('4,800bps 8N1은 올림한 t3.5의 4배인 32ms를 사용한다', () => {
    expect(modbusRtuInterFrameDelayMs({ baudRate: 4_800, dataBits: 8, stopBits: 1, parity: SerialParity.None, flowControl: SerialFlowControl.None })).toBe(32)
  })

  it('9,600bps 8E1은 올림한 t3.5의 4배인 20ms를 사용한다', () => {
    expect(modbusRtuInterFrameDelayMs({ baudRate: 9_600, dataBits: 8, stopBits: 1, parity: SerialParity.Even, flowControl: SerialFlowControl.None })).toBe(20)
  })

  it('19,200bps는 계산한 t3.5의 4배인 8ms를 사용한다', () => {
    expect(modbusRtuInterFrameDelayMs({ baudRate: 19_200, dataBits: 8, stopBits: 1, parity: SerialParity.None, flowControl: SerialFlowControl.None })).toBe(8)
  })

  it('19,200bps를 초과하면 권고 고정값 1.75ms의 4배인 8ms를 사용한다', () => {
    expect(modbusRtuInterFrameDelayMs({ baudRate: 115_200, dataBits: 8, stopBits: 1, parity: SerialParity.None, flowControl: SerialFlowControl.None })).toBe(8)
  })
})
