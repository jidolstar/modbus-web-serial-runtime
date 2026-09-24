import {
  RecipeFormatterType,
  RecipeSchemaVersion,
  type RecipeOutput,
  type RecipeOutputV2,
} from '../device-catalog/recipe.types'
import { RecipeExecutionError } from './recipe-execution-errors'

const LEGACY_SOURCE_PATTERN = /^([A-Za-z][A-Za-z0-9_]*)\[([0-9]+)\]$/

/** v1 output을 실행 엔진의 단일 v2 표현으로 바꿔 이전 Catalog와의 호환을 유지한다. */
export function normalizeRecipeOutput(output: RecipeOutput, recipeId: string): RecipeOutputV2 {
  if ('decode' in output) return output
  const source = LEGACY_SOURCE_PATTERN.exec(output.source)
  if (!source) throw new RecipeExecutionError(`잘못된 output source입니다: ${output.source}`, recipeId)
  return Object.freeze({
    name: output.name,
    source: Object.freeze({ variable: source[1], start: Number(source[2]), count: 1 }),
    decode: Object.freeze({ type: output.decoder }),
    transform: Object.freeze({ scale: output.scale, offset: output.offset }),
    format: Object.freeze({ type: RecipeFormatterType.Number, unit: output.unit }),
  })
}

/** schemaVersion과 output 표현이 섞인 작성 오류를 저장 전에 찾기 위한 보조 함수다. */
export function usesExpectedOutputVersion(schemaVersion: RecipeSchemaVersion, output: RecipeOutput): boolean {
  return schemaVersion === RecipeSchemaVersion.Version1 ? 'decoder' in output : 'decode' in output
}
