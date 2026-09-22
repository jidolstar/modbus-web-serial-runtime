/** Recipe Step 하나의 최종 실행 상태다. */
export enum RecipeStepExecutionStatus {
  Succeeded = 'succeeded',
  Failed = 'failed',
}

/** Recipe 실행 전체의 최종 상태다. */
export enum RecipeExecutionStatus {
  Succeeded = 'succeeded',
}

/** 실행 context에 저장할 수 있는 안전한 값의 범위다. */
export type RecipeContextValue = number | string | ReadonlyArray<number>

/** Step별 수행 시간과 오류를 남기는 구조화된 결과다. */
export interface RecipeStepResult {
  readonly stepId: string
  readonly status: RecipeStepExecutionStatus
  readonly startedAt: Date
  readonly finishedAt: Date
  readonly errorMessage?: string
}

/** decoder가 만든 화면/서비스용 named output이다. */
export interface RecipeNamedOutput {
  readonly value: number
  readonly unit?: string
}

/** Recipe가 성공했을 때 반환하는 불변 실행 결과다. */
export interface RecipeExecutionResult {
  readonly recipeId: string
  readonly status: RecipeExecutionStatus
  readonly steps: ReadonlyArray<RecipeStepResult>
  readonly outputs: Readonly<Record<string, RecipeNamedOutput>>
  readonly context: Readonly<Record<string, RecipeContextValue>>
}

/** Recipe 실행자가 제공해야 하는 최소 계약이다. */
export interface RecipeRunner {
  execute(
    profileId: string,
    recipeId: string,
    parameters?: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<RecipeExecutionResult>
}
