import { RecipeDecoderType, type RecipeOutput } from '../device-catalog/recipe.types'
import { RecipeExecutionError } from './recipe-execution-errors'
import type {
  RecipeContextValue,
  RecipeNamedOutput,
} from './recipe-execution.types'

/** `contextVariable[index]`만 output source로 인정한다. */
const OUTPUT_SOURCE_PATTERN = /^([A-Za-z][A-Za-z0-9_]*)\[([0-9]+)\]$/

/** 16-bit unsigned register의 최댓값이다. */
const UINT16_MAX = 0xffff

/** int16에서 음수 부호가 시작되는 최상위 bit 값이다. */
const INT16_SIGN_BIT = 0x8000

/** int16 변환 시 unsigned 값에서 빼는 2의 보수 범위다. */
const UINT16_RANGE = 0x10000

/** register context를 선언된 decoder/scale/offset에 따라 named output으로 변환한다. */
export class RecipeOutputDecoder {
  public decode(
    output: RecipeOutput,
    context: ReadonlyMap<string, RecipeContextValue>,
    recipeId: string,
  ): RecipeNamedOutput {
    const sourceMatch = OUTPUT_SOURCE_PATTERN.exec(output.source)
    if (!sourceMatch) {
      throw new RecipeExecutionError(`잘못된 output source입니다: ${output.source}`, recipeId)
    }

    const registerValues = context.get(sourceMatch[1])
    const registerIndex = Number(sourceMatch[2])
    if (!Array.isArray(registerValues) || registerValues[registerIndex] === undefined) {
      throw new RecipeExecutionError(`Output source를 찾을 수 없습니다: ${output.source}`, recipeId)
    }

    const rawRegisterValue = registerValues[registerIndex]
    if (!Number.isInteger(rawRegisterValue) || rawRegisterValue < 0 || rawRegisterValue > UINT16_MAX) {
      throw new RecipeExecutionError(`16-bit register 값이 아닙니다: ${rawRegisterValue}`, recipeId)
    }

    const decodedValue = output.decoder === RecipeDecoderType.Signed16
      ? (rawRegisterValue >= INT16_SIGN_BIT ? rawRegisterValue - UINT16_RANGE : rawRegisterValue)
      : rawRegisterValue
    const scale = output.scale ?? 1
    const offset = output.offset ?? 0

    return Object.freeze({ value: (decodedValue * scale) + offset, unit: output.unit })
  }
}
