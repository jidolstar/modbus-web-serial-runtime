import { describe, expect, it, vi } from 'vitest'
import type { RecipeExecutionResult, RecipeRunner } from '../recipe-engine/recipe-execution.types'
import { RecipeExecutionStatus } from '../recipe-engine/recipe-execution.types'
import { SensorMonitor } from './sensor-monitor'

/** SensorMonitor 테스트에서 재사용하는 빈 성공 결과다. */
const SUCCESS_RESULT: RecipeExecutionResult = Object.freeze({
  recipeId: 'test.measurement',
  status: RecipeExecutionStatus.Succeeded,
  steps: Object.freeze([]),
  outputs: Object.freeze({}),
  context: Object.freeze({}),
})

/** 실행 시각과 AbortSignal을 기록하는 제어 가능한 RecipeRunner다. */
class RecordingRecipeRunner implements RecipeRunner {
  public readonly signals: AbortSignal[] = []
  public readonly executionTimes: number[] = []
  public resolver: (() => void) | null = null

  public async execute(
    _profileId: string,
    _recipeId: string,
    _parameters?: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<RecipeExecutionResult> {
    if (signal) this.signals.push(signal)
    this.executionTimes.push(Date.now())
    if (this.resolver !== null) await new Promise<void>((resolve) => { this.resolver = resolve })
    return SUCCESS_RESULT
  }
}

describe('SensorMonitor', () => {
  it('이전 측정이 끝난 뒤에만 다음 측정을 예약해 실행이 겹치지 않는다', async () => {
    vi.useFakeTimers()
    try {
      const runner = new RecordingRecipeRunner()
      const pendingExecution: { release: (() => void) | null } = { release: null }
      runner.resolver = () => {}
      runner.execute = vi.fn(async () => {
        runner.executionTimes.push(Date.now())
        await new Promise<void>((resolve) => { pendingExecution.release = resolve })
        return SUCCESS_RESULT
      })
      const monitor = new SensorMonitor(runner, 3_000)
      const request = { profileId: 'p', recipeId: 'r', parameters: {} }
      monitor.start(request, { onMeasurement: () => {}, onError: () => {} })

      await vi.advanceTimersByTimeAsync(6_000)
      expect(runner.executionTimes).toHaveLength(1)

      pendingExecution.release?.()
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(2_999)
      expect(runner.executionTimes).toHaveLength(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(runner.executionTimes).toHaveLength(2)
      monitor.stop()
    } finally {
      vi.useRealTimers()
    }
  })

  it('stop 후 timer와 실행 signal을 폐기하고 start 시 새 session을 만든다', async () => {
    vi.useFakeTimers()
    try {
      const execute = vi.fn(async (
        _profileId: string,
        _recipeId: string,
        _parameters?: Readonly<Record<string, unknown>>,
        signal?: AbortSignal,
      ) => {
        if (signal?.aborted) throw new Error('aborted')
        return SUCCESS_RESULT
      })
      const runner: RecipeRunner = { execute }
      const monitor = new SensorMonitor(runner, 3_000)
      const request = { profileId: 'p', recipeId: 'r', parameters: {} }
      const observer = { onMeasurement: () => {}, onError: () => {} }

      monitor.start(request, observer)
      await Promise.resolve()
      monitor.stop()
      await vi.advanceTimersByTimeAsync(6_000)
      expect(execute).toHaveBeenCalledTimes(1)
      const firstSignal = execute.mock.calls[0][3]
      expect(firstSignal?.aborted).toBe(true)

      monitor.start(request, observer)
      await Promise.resolve()
      const secondSignal = execute.mock.calls[1][3]
      expect(secondSignal).not.toBe(firstSignal)
      expect(secondSignal?.aborted).toBe(false)
      monitor.stop()
    } finally {
      vi.useRealTimers()
    }
  })
})
