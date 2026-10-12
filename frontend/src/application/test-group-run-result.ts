import type { RecipeNamedOutput } from '../recipe-engine/recipe-execution.types'

export type TestGroupNodeStatus = 'waiting' | 'running' | 'succeeded' | 'timeout' | 'modbus-exception' | 'recipe-error' | 'disconnected' | 'cancelled'

export interface TestGroupNodeResult {
  readonly nodeId: number
  readonly status: TestGroupNodeStatus
  readonly outputs: Readonly<Record<string, RecipeNamedOutput>>
  readonly startedAt: Date | null
  readonly finishedAt: Date | null
  readonly cycle: number | null
  readonly message?: string
}
