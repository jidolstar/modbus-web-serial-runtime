import { RecipeKind, RecipeStepType, STANDARD_DEVICE_ID_PARAMETER } from '../device-catalog/recipe.types'
import type { DeviceCatalog } from '../device-catalog/catalog.types'
import type { RecipeExecutionResult, RecipeRunner } from '../recipe-engine/recipe-execution.types'

/** Catalog allowlist에 공개된 write Recipe만 실행하는 application 경계다. */
export class DeviceActionRunner {
  public constructor(
    private readonly catalog: DeviceCatalog,
    private readonly recipeRunner: RecipeRunner,
  ) {}

  public async execute(
    profileId: string,
    recipeId: string,
    slaveId: number,
    parameters: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<RecipeExecutionResult> {
    const profile = this.catalog.getProfile(profileId)
    if (!profile.recipes.actions?.includes(recipeId)) {
      throw new Error(`Profile이 허용하지 않는 추가 작업입니다: ${recipeId}`)
    }
    const recipe = this.catalog.getRecipe(recipeId)
    if (recipe.kind !== RecipeKind.Configuration
      || !recipe.steps.some(({ type }) => type === RecipeStepType.WriteSingleRegister)) {
      throw new Error(`추가 작업은 writeSingleRegister를 포함한 configuration Recipe여야 합니다: ${recipeId}`)
    }
    const supplied = recipe.parameters?.some(({ name }) => name === STANDARD_DEVICE_ID_PARAMETER)
      ? { ...parameters, [STANDARD_DEVICE_ID_PARAMETER]: slaveId }
      : parameters
    return this.recipeRunner.execute(profileId, recipeId, Object.freeze(supplied), signal)
  }
}
