/** Scan 또는 설정 변경이 AbortSignal에 의해 중단됐음을 나타낸다. */
export class OperationAbortedError extends Error {
  public constructor(message = '장비 작업이 취소되었습니다.', options?: ErrorOptions) {
    super(message, options)
    this.name = 'OperationAbortedError'
  }
}

/** Error.cause 연결을 순회해 지정한 오류 class를 찾는다. 순환 cause는 한 번만 방문한다. */
export function findErrorCause<T extends Error>(
  error: unknown,
  errorType: abstract new (...args: never[]) => T,
): T | null {
  const visitedErrors = new Set<Error>()
  let currentError = error

  while (currentError instanceof Error && !visitedErrors.has(currentError)) {
    if (currentError instanceof errorType) return currentError
    visitedErrors.add(currentError)
    currentError = currentError.cause
  }
  return null
}

/** 다음 I/O를 시작하기 전에 AbortSignal을 확인한다. */
export function throwIfOperationAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new OperationAbortedError('장비 작업이 취소되었습니다.', { cause: signal.reason })
  }
}
