/**
 * RS485 bus 요청을 한 번에 하나씩 실행하는 FIFO queue다.
 *
 * UI, Scanner, Recipe가 동시에 요청해도 이전 요청의 응답 또는 실패가 확정된 뒤 다음 요청을 시작한다.
 */
export class SerialTransactionQueue {
  /** 마지막 queue slot이 끝날 때까지 기다리는 Promise chain이다. */
  #queueTail: Promise<void> = Promise.resolve()

  /** disconnect 이전에 등록된 작업을 구분하기 위한 queue 세대 번호다. */
  #generation = 0

  /** 가장 최근 invalidate 사유다. 이전 세대 작업이 시작되기 전에 이 오류로 종료된다. */
  #invalidationError: Error = new Error('Serial transaction queue가 초기화되었습니다.')

  /** operation을 FIFO 순서로 실행하고 그 결과를 호출자에게 반환한다. */
  public enqueue<TResult>(operation: () => Promise<TResult>): Promise<TResult> {
    const operationGeneration = this.#generation
    const previousSlot = this.#queueTail

    /** 뒤 작업이 기다릴 현재 queue slot의 완료 callback이다. */
    let releaseCurrentSlot: () => void = () => undefined
    this.#queueTail = new Promise<void>((resolve) => {
      releaseCurrentSlot = resolve
    })

    return previousSlot
      .then(async () => {
        if (operationGeneration !== this.#generation) throw this.#invalidationError
        return operation()
      })
      .finally(releaseCurrentSlot)
  }

  /** 연결 종료 시 아직 시작하지 않은 이전 세대 작업을 지정된 오류로 무효화한다. */
  public invalidate(reason: Error): void {
    this.#generation += 1
    this.#invalidationError = reason
  }
}
