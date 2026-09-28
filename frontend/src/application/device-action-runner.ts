import { RecipeKind, RecipeStepType, STANDARD_DEVICE_ID_PARAMETER } from '../device-catalog/recipe.types'
import type { DeviceCatalog } from '../device-catalog/catalog.types'
import type { RecipeExecutionResult, RecipeRunner } from '../recipe-engine/recipe-execution.types'

/** Test Device가 Catalog allowlist에 공개된 일회성 조회·설정 Recipe만 실행하도록 막는 application 경계다. */
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
    if ([profile.recipes.changeSlaveId, profile.recipes.changeBaudRate].includes(recipeId)
      || recipe.steps.some(({ type }) => type === RecipeStepType.ReopenSerial)) {
      throw new Error(`추가 작업에서는 표준 통신 설정 변경이나 Serial 재연결을 실행할 수 없습니다: ${recipeId}`)
    }
    const hasRead = recipe.steps.some(({ type }) => type === RecipeStepType.ReadHoldingRegisters)
    const hasWrite = recipe.steps.some(({ type }) => type === RecipeStepType.WriteSingleRegister)
    const isReadableAction = recipe.kind === RecipeKind.Measurement && hasRead && !hasWrite && Boolean(recipe.outputs?.length)
    const isWritableAction = recipe.kind === RecipeKind.Configuration && hasWrite
    if (!isReadableAction && !isWritableAction) {
      throw new Error(`추가 작업 Recipe의 읽기 또는 쓰기 계약이 올바르지 않습니다: ${recipeId}`)
    }
    const supplied = recipe.parameters?.some(({ name }) => name === STANDARD_DEVICE_ID_PARAMETER)
      ? { ...parameters, [STANDARD_DEVICE_ID_PARAMETER]: slaveId }
      : parameters
    return this.recipeRunner.execute(profileId, recipeId, Object.freeze(supplied), signal)
  }
}
