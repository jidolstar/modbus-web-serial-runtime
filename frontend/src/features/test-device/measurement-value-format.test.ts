import { describe, expect, it } from 'vitest'
import { formatMeasurementValue } from './measurement-value-format'

describe('formatMeasurementValue', () => {
  it('scale 정밀도로 부동소수점 표시 오차를 제거한다', () => {
    expect(formatMeasurementValue(64.60000000000001, { scale: 0.1 })).toBe('64.6')
  })

  it('정수 결과에도 Catalog가 선언한 scale 정밀도를 표시한다', () => {
    expect(formatMeasurementValue(23, { scale: 0.1 })).toBe('23.0')
    expect(formatMeasurementValue(23, { scale: 0.01 })).toBe('23.00')
    expect(formatMeasurementValue(1234, undefined)).toBe('1234')
  })

  it('offset이 scale보다 정밀하면 offset 자릿수를 사용한다', () => {
    expect(formatMeasurementValue(1.2500000000000002, { scale: 0.1, offset: 0.05 })).toBe('1.25')
  })
})
