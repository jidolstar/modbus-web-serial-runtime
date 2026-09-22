import { describe, expect, it } from 'vitest'
import { parseIntegerSetting } from './runtime-config'

describe('parseIntegerSetting', () => {
  it('환경변수가 없으면 문서화된 기본값을 사용한다', () => {
    expect(parseIntegerSetting('TEST_SETTING', undefined, 3_000, 250, 60_000)).toBe(3_000)
  })

  it('범위 안의 정수 문자열을 number로 변환한다', () => {
    expect(parseIntegerSetting('TEST_SETTING', '1200', 3_000, 100, 60_000)).toBe(1_200)
  })

  it('범위를 벗어난 값은 조용히 보정하지 않고 거부한다', () => {
    expect(() => parseIntegerSetting('TEST_SETTING', '10', 3_000, 100, 60_000)).toThrow(
      'TEST_SETTING',
    )
  })
})
