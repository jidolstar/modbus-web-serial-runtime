import type { SerialDisconnectReason } from './serial-connection-state'

/** Serial 계층에서 발생한 오류의 공통 기반 class다. */
export class SerialError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

/** 연결되지 않은 transport에서 통신을 시도했을 때 발생한다. */
export class SerialNotConnectedError extends SerialError {}

/** 포트에 byte를 쓰는 도중 연결이 끊기거나 전송이 실패했을 때 발생한다. */
export class SerialWriteError extends SerialError {}

/** 연결 종료 사유를 함께 전달하는 오류다. */
export class SerialDisconnectedError extends SerialError {
  public constructor(
    message: string,
    public readonly reason: SerialDisconnectReason,
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}
