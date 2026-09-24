import { RecipeFormatterType, type RecipeFormat } from '../device-catalog/recipe.types'
import { RecipeExecutionError } from './recipe-execution-errors'

export type RecipeDecodedValue = number | string | boolean
export interface RecipeDisplayValue { readonly text: string; readonly unit?: string }
export type CustomOutputFormatter = (value: RecipeDecodedValue, options: Readonly<Record<string, string | number | boolean>>) => RecipeDisplayValue
const FORMATTER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const MAX_DISPLAY_TEXT_LENGTH = 512

function decimalPlaces(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) return 0
  const text = Math.abs(value).toString().toLowerCase()
  if (text.includes('e-')) return Math.min(12, Number(text.split('e-')[1]))
  return text.includes('.') ? text.split('.')[1].length : 0
}

/** Catalog에는 formatter ID만 허용하고 실제 코드는 이 정적 allowlist에 앱 배포 시 등록한다. */
export class RecipeOutputFormatterRegistry {
  readonly #custom = new Map<string, CustomOutputFormatter>()

  public register(id: string, formatter: CustomOutputFormatter): void {
    if (!FORMATTER_ID_PATTERN.test(id)) throw new Error(`잘못된 Formatter ID입니다: ${id}`)
    if (this.#custom.has(id)) throw new Error(`Formatter가 이미 등록되었습니다: ${id}`)
    this.#custom.set(id, formatter)
  }

  /** 관리 UI와 실행 전 점검에서 formatter가 현재 Frontend 배포본에 포함됐는지 확인한다. */
  public supports(format: RecipeFormat): boolean {
    return format.type !== RecipeFormatterType.Custom || this.#custom.has(format.formatterId)
  }

  public format(value: RecipeDecodedValue, format: RecipeFormat, recipeId: string, fractionHint = 0): RecipeDisplayValue {
    switch (format.type) {
      case RecipeFormatterType.Number: {
        if (typeof value !== 'number') throw new RecipeExecutionError('number formatter에는 숫자 값이 필요합니다.', recipeId)
        const digits = format.fractionDigits ?? fractionHint
        return Object.freeze({ text: value.toLocaleString('ko-KR', { minimumFractionDigits: digits, maximumFractionDigits: digits }), unit: format.unit })
      }
      case RecipeFormatterType.Text:
        if (typeof value !== 'string') throw new RecipeExecutionError('text formatter에는 문자열 값이 필요합니다.', recipeId)
        return Object.freeze({ text: value })
      case RecipeFormatterType.Boolean:
        if (typeof value !== 'boolean') throw new RecipeExecutionError('boolean formatter에는 boolean 값이 필요합니다.', recipeId)
        return Object.freeze({ text: value ? (format.trueLabel ?? 'true') : (format.falseLabel ?? 'false') })
      case RecipeFormatterType.Enum:
        if (typeof value === 'boolean') throw new RecipeExecutionError('enum formatter에는 숫자 또는 문자열 값이 필요합니다.', recipeId)
        return Object.freeze({ text: format.values[String(value)] ?? String(value) })
      case RecipeFormatterType.Custom: {
        const formatter = this.#custom.get(format.formatterId)
        if (!formatter) throw new RecipeExecutionError(`등록되지 않은 formatter입니다: ${format.formatterId}`, recipeId)
        try {
          const result = formatter(value, format.options ?? Object.freeze({}))
          if (typeof result?.text !== 'string' || result.text.length > MAX_DISPLAY_TEXT_LENGTH || (result.unit !== undefined && typeof result.unit !== 'string')) {
            throw new Error('formatter 반환값이 허용된 display 계약과 일치하지 않습니다.')
          }
          return Object.freeze({ text: result.text, unit: result.unit })
        } catch {
          throw new RecipeExecutionError(`Custom formatter 실행에 실패했습니다: ${format.formatterId}`, recipeId)
        }
      }
    }
  }

  public static fractionHint(scale?: number, offset?: number): number {
    return Math.max(decimalPlaces(scale), decimalPlaces(offset))
  }
}

/** 관리 UI와 기본 Recipe 실행기가 같은 사전 배포 custom formatter 목록을 보도록 공유한다. */
export const recipeOutputFormatterRegistry = new RecipeOutputFormatterRegistry()
