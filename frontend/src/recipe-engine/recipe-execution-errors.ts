import type { RecipeStepResult } from './recipe-execution.types'

/** Recipe 정의, parameter 또는 실행 과정에서 발생하는 공통 오류다. */
export class RecipeExecutionError extends Error {
  public constructor(
    message: string,
    public readonly recipeId: string,
    public readonly stepId?: string,
    public readonly completedSteps: ReadonlyArray<RecipeStepResult> = [],
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = 'RecipeExecutionError'
  }
}

/** AbortSignal로 사용자가 Recipe 실행을 중단했음을 나타낸다. */
export class RecipeAbortedError extends RecipeExecutionError {
  public constructor(
    recipeId: string,
    stepId?: string,
    completedSteps: ReadonlyArray<RecipeStepResult> = [],
    options?: ErrorOptions,
  ) {
    super('Recipe 실행이 취소되었습니다.', recipeId, stepId, completedSteps, options)
    this.name = 'RecipeAbortedError'
  }
}
