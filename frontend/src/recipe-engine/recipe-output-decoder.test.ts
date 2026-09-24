import { describe, expect, it } from 'vitest'
import {
  RecipeDecoderType, RecipeFormatterType, RecipeRegisterByteOrder, RecipeRegisterOrder, RecipeStringTrim,
  type RecipeOutputV2,
} from '../device-catalog/recipe.types'
import { RecipeOutputDecoder } from './recipe-output-decoder'
import { RecipeOutputFormatterRegistry } from './recipe-output-formatter'

const RECIPE_ID = 'decoder-test'
const context = (registers: ReadonlyArray<number>) => new Map([['registers', registers]])

function output(decode: RecipeOutputV2['decode'], count: number, format: RecipeOutputV2['format'] = { type: RecipeFormatterType.Number }): RecipeOutputV2 {
  return { name: 'value', source: { variable: 'registers', start: 0, count }, decode, format }
}

describe('RecipeOutputDecoder', () => {
  const decoder = new RecipeOutputDecoder()

  it.each([
    [RecipeDecoderType.Unsigned16, [0xffff], 65_535],
    [RecipeDecoderType.Signed16, [0xffff], -1],
    [RecipeDecoderType.Unsigned32, [0x1234, 0x5678], 0x12345678],
    [RecipeDecoderType.Signed32, [0xffff, 0xfffe], -2],
    [RecipeDecoderType.Float32, [0x3fc0, 0], 1.5],
    [RecipeDecoderType.Float64, [0x3ff8, 0, 0, 0], 1.5],
  ] as const)('%s register를 숫자로 해석한다', (type, registers, expected) => {
    expect(decoder.decode(output({ type }, registers.length), context(registers), RECIPE_ID).value).toBe(expected)
  })

  it('word/byte order를 각각 적용한다', () => {
    const contract = output({ type: RecipeDecoderType.Unsigned32, registerOrder: RecipeRegisterOrder.LowWordFirst, byteOrder: RecipeRegisterByteOrder.LowByteFirst }, 2)
    expect(decoder.decode(contract, context([0x7856, 0x3412]), RECIPE_ID).value).toBe(0x12345678)
  })

  it('bit, ASCII, hex 값을 각 타입으로 반환한다', () => {
    expect(decoder.decode(output({ type: RecipeDecoderType.Bit, bitIndex: 3 }, 1, { type: RecipeFormatterType.Boolean, trueLabel: '알람', falseLabel: '정상' }), context([8]), RECIPE_ID)).toEqual({ value: true, display: { text: '알람' } })
    expect(decoder.decode(output({ type: RecipeDecoderType.Ascii, trim: RecipeStringTrim.NullAndSpace }, 3, { type: RecipeFormatterType.Text }), context([0x4142, 0x4320, 0]), RECIPE_ID).value).toBe('ABC')
    expect(decoder.decode(output({ type: RecipeDecoderType.Hex }, 2, { type: RecipeFormatterType.Text }), context([0x1234, 0xabcd]), RECIPE_ID).value).toBe('12 34 AB CD')
  })

  it('scale 정밀도를 표시값에 유지하고 원본 typed value도 보존한다', () => {
    const contract = { ...output({ type: RecipeDecoderType.Signed16 }, 1), transform: { scale: 0.1 }, format: { type: RecipeFormatterType.Number, unit: '°C' } } as const
    expect(decoder.decode(contract, context([230]), RECIPE_ID)).toEqual({ value: 23, display: { text: '23.0', unit: '°C' } })
  })

  it('문자열 decoder의 transform과 등록되지 않은 custom formatter를 거부한다', () => {
    const textWithScale = { ...output({ type: RecipeDecoderType.Ascii }, 1, { type: RecipeFormatterType.Text }), transform: { scale: 0.1 } } as const
    expect(() => decoder.decode(textWithScale, context([0x4142]), RECIPE_ID)).toThrow(/숫자 decoder/)
    expect(() => decoder.decode(output({ type: RecipeDecoderType.Unsigned16 }, 1, { type: RecipeFormatterType.Custom, formatterId: 'missing' }), context([1]), RECIPE_ID)).toThrow(/등록되지 않은 formatter/)
  })

  it('앱 코드에 정적으로 등록한 custom formatter만 실행한다', () => {
    const registry = new RecipeOutputFormatterRegistry()
    expect(registry.supports({ type: RecipeFormatterType.Number })).toBe(true)
    expect(registry.supports({ type: RecipeFormatterType.Custom, formatterId: 'yes-no' })).toBe(false)
    registry.register('yes-no', (value) => ({ text: value === 1 ? 'YES' : 'NO' }))
    expect(registry.supports({ type: RecipeFormatterType.Custom, formatterId: 'yes-no' })).toBe(true)
    const customDecoder = new RecipeOutputDecoder(registry)
    expect(customDecoder.decode(output({ type: RecipeDecoderType.Unsigned16 }, 1, { type: RecipeFormatterType.Custom, formatterId: 'yes-no' }), context([1]), RECIPE_ID).display.text).toBe('YES')
  })
})
