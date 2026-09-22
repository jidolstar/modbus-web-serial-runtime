/** Serial 연결의 전체 생명주기를 나타내는 유한 상태 집합이다. */
export enum SerialConnectionState {
  Idle = 'idle',
  RequestingPort = 'requesting-port',
  Opening = 'opening',
  Connected = 'connected',
  Reconfiguring = 'reconfiguring',
  Closing = 'closing',
  Disconnected = 'disconnected',
  Faulted = 'faulted',
}

/** 연결이 종료된 원인을 상위 계층과 UI가 구분할 때 사용하는 값이다. */
export enum SerialDisconnectReason {
  UserRequested = 'user-requested',
  DeviceRemoved = 'device-removed',
  ReadFailure = 'read-failure',
  WriteFailure = 'write-failure',
  ApplicationDisposed = 'application-disposed',
}

/** 연결 상태가 바뀔 때 구독자에게 전달하는 불변 event다. */
export interface SerialConnectionStateEvent {
  /** 상태 전환 직전의 연결 상태다. */
  readonly previousState: SerialConnectionState

  /** 상태 전환이 완료된 뒤의 연결 상태다. */
  readonly currentState: SerialConnectionState

  /** 연결이 종료된 경우 그 원인을 설명한다. */
  readonly disconnectReason?: SerialDisconnectReason

  /** 장애가 상태 전환을 일으킨 경우 원본 오류다. */
  readonly error?: Error
}
