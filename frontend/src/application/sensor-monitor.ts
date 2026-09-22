import type { RecipeRunner, RecipeExecutionResult } from '../recipe-engine/recipe-execution.types'

/** SensorMonitor가 실행할 Profile/Recipe와 검증된 parameter 모음이다. */
export interface SensorMonitorRequest {
  readonly profileId: string
  readonly recipeId: string
  readonly parameters: Readonly<Record<string, unknown>>
}

/** 측정 성공과 실패를 Runtime에 전달하는 callback 계약이다. */
export interface SensorMonitorObserver {
  readonly onMeasurement: (result: RecipeExecutionResult) => void
  readonly onError: (error: Error) => void
}

/** Runtime이 구체적인 timer 구현과 분리되어 사용하는 polling 제어 계약이다. */
export interface SensorMonitorControl {
  start(request: SensorMonitorRequest, observer: SensorMonitorObserver): void
  stop(): void
}

/** 활성 polling session이 소유하는 취소 신호와 다음 실행 timer다. */
interface PollingSession {
  readonly generation: number
  readonly abortController: AbortController
  timerId: ReturnType<typeof setTimeout> | null
}

/** polling 간격으로 허용하는 최소값이다. RuntimeConfig와 동일한 안전 하한이다. */
const MINIMUM_POLL_INTERVAL_MS = 250

/** polling 간격으로 허용하는 최대값이다. */
const MAXIMUM_POLL_INTERVAL_MS = 60_000

/**
 * Recipe 측정을 겹치지 않게 순차 실행하는 polling 관리자다.
 *
 * setInterval을 사용하지 않고 한 번의 실행이 끝난 뒤 다음 timer를 예약하므로,
 * 느린 장비 응답이 다음 요청과 중첩되지 않는다.
 */
export class SensorMonitor implements SensorMonitorControl {
  #activeSession: PollingSession | null = null
  #nextGeneration = 0

  public constructor(
    private readonly recipeRunner: RecipeRunner,
    private readonly pollIntervalMs: number,
  ) {
    if (!Number.isInteger(pollIntervalMs)
      || pollIntervalMs < MINIMUM_POLL_INTERVAL_MS
      || pollIntervalMs > MAXIMUM_POLL_INTERVAL_MS) {
      throw new Error(
        `측정 주기는 ${MINIMUM_POLL_INTERVAL_MS}~${MAXIMUM_POLL_INTERVAL_MS}ms 정수여야 합니다.`,
      )
    }
  }

  /** 기존 session을 폐기하고 즉시 첫 측정을 시작하는 새 session을 만든다. */
  public start(request: SensorMonitorRequest, observer: SensorMonitorObserver): void {
    this.stop()
    const session: PollingSession = {
      generation: ++this.#nextGeneration,
      abortController: new AbortController(),
      timerId: null,
    }
    this.#activeSession = session
    void this.#pollOnce(session, request, observer)
  }

  /** timer를 해제하고 진행 중 Recipe에 취소 신호를 보내 후속 측정을 막는다. */
  public stop(): void {
    const session = this.#activeSession
    if (!session) return
    this.#activeSession = null
    if (session.timerId !== null) globalThis.clearTimeout(session.timerId)
    session.abortController.abort('SensorMonitor session 종료')
  }

  /** 현재 session인지 generation과 객체 identity를 함께 확인한다. */
  #isActive(session: PollingSession): boolean {
    return this.#activeSession === session
      && this.#activeSession.generation === session.generation
      && !session.abortController.signal.aborted
  }

  /** 한 번 측정한 뒤 완료 시점부터 다음 실행까지의 timer를 예약한다. */
  async #pollOnce(
    session: PollingSession,
    request: SensorMonitorRequest,
    observer: SensorMonitorObserver,
  ): Promise<void> {
    try {
      const result = await this.recipeRunner.execute(
        request.profileId,
        request.recipeId,
        request.parameters,
        session.abortController.signal,
      )
      if (this.#isActive(session)) observer.onMeasurement(result)
    } catch (error) {
      if (this.#isActive(session)) {
        observer.onError(error instanceof Error ? error : new Error(String(error)))
      }
    }

    if (!this.#isActive(session)) return
    session.timerId = globalThis.setTimeout(() => {
      session.timerId = null
      void this.#pollOnce(session, request, observer)
    }, this.pollIntervalMs)
  }
}
