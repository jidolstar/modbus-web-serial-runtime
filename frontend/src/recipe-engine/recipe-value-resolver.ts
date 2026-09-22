import type { DeviceProfile } from '../device-catalog/device-profile.types'
import type { RecipeMapLookup, RecipeValue } from '../device-catalog/recipe.types'
import { RecipeExecutionError } from './recipe-execution-errors'
import type { RecipeContextValue } from './recipe-execution.types'

/** `${variableName}` 전체 문자열만 변수 참조로 인정한다. */
const VARIABLE_REFERENCE_PATTERN = /^\$\{([A-Za-z][A-Za-z0-9_]*)\}$/

/** 객체가 Profile map 조회 선언인지 확인할 때 사용하는 최소 구조 검사다. */
function isMapLookup(value: RecipeValue): value is RecipeMapLookup {
  return typeof value === 'object' && value !== null && 'map' in value && 'key' in value
}

/**
 * Recipe의 제한된 값 표현을 숫자로 변환한다.
 *
 * 일반 property path나 표현식은 지원하지 않으므로 외부 JSON이 임의 객체에
 * 접근하거나 JavaScript를 실행할 수 없다.
 */
export class RecipeValueResolver {
  public resolveNumber(
    value: RecipeValue,
    context: ReadonlyMap<string, RecipeContextValue>,
    profile: DeviceProfile,
    recipeId: string,
  ): number {
    if (typeof value === 'number') return this.#assertFiniteNumber(value, recipeId)

    if (typeof value === 'string') {
      const variableName = this.#parseVariableReference(value, recipeId)
      const resolvedValue = context.get(variableName)
      if (typeof resolvedValue !== 'number') {
        throw new RecipeExecutionError(`숫자 변수 '${variableName}'을(를) 찾을 수 없습니다.`, recipeId)
      }
      return this.#assertFiniteNumber(resolvedValue, recipeId)
    }

    if (!isMapLookup(value)) {
      throw new RecipeExecutionError('지원하지 않는 Recipe 값 형식입니다.', recipeId)
    }

    const keyVariableName = this.#parseVariableReference(value.key, recipeId)
    const mapKey = context.get(keyVariableName)
    if (typeof mapKey !== 'number' && typeof mapKey !== 'string') {
      throw new RecipeExecutionError(`Map key 변수 '${keyVariableName}'을(를) 찾을 수 없습니다.`, recipeId)
    }

    const profileMap = profile.maps?.[value.map]
    const mappedValue = profileMap?.[String(mapKey)]
    if (mappedValue === undefined) {
      throw new RecipeExecutionError(
        `Profile map '${value.map}'에 key '${String(mapKey)}'가 없습니다.`,
        recipeId,
      )
    }
    return this.#assertFiniteNumber(mappedValue, recipeId)
  }

  /** 허용된 변수 문법을 검사하고 변수 이름만 반환한다. */
  #parseVariableReference(reference: string, recipeId: string): string {
    const match = VARIABLE_REFERENCE_PATTERN.exec(reference)
    if (!match) throw new RecipeExecutionError(`잘못된 변수 참조입니다: ${reference}`, recipeId)
    return match[1]
  }

  /** JSON number 중 NaN/Infinity 같은 통신 불가능 값을 차단한다. */
  #assertFiniteNumber(value: number, recipeId: string): number {
    if (!Number.isFinite(value)) throw new RecipeExecutionError('Recipe 숫자는 유한해야 합니다.', recipeId)
    return value
  }
}
