import type {
  SerialConnectionState,
  SerialConnectionStateEvent,
  SerialDisconnectReason,
} from './serial-connection-state'
import type { SerialConfig, SerialDataListener, Unsubscribe } from './serial-types'

/**
 * byte 기반 Serial 통신의 안정적인 경계다.
 *
 * Modbus 계층은 브라우저 Web Serial API 대신 이 계약에만 의존한다.
 */
export interface SerialTransport {
  /** 현재 연결 생명주기 상태다. */
  readonly connectionState: SerialConnectionState

  /** 현재 브라우저에서 Web Serial 기능을 사용할 수 있는지 나타낸다. */
  readonly isSupported: boolean

  /** 사용자 선택 UI를 열어 사용할 port 권한을 얻는다. 반드시 사용자 동작에서 호출한다. */
  requestPort(): Promise<void>

  /** 선택된 port를 전달받은 설정으로 연다. */
  open(config: SerialConfig): Promise<void>

  /** 기존 권한 port를 사용해 다시 연결한다. */
  reconnect(config?: SerialConfig): Promise<void>

  /** Baudrate 변경처럼 의도적으로 port를 닫고 새 설정으로 다시 연다. */
  reopen(config: SerialConfig): Promise<void>

  /** 연결을 종료하고 진행 중인 I/O resource를 안전하게 정리한다. */
  close(reason?: SerialDisconnectReason): Promise<void>

  /** 열린 port에 byte를 전송한다. */
  write(data: Uint8Array): Promise<void>

  /** 수신 byte chunk를 관찰할 listener를 등록한다. */
  subscribeData(listener: SerialDataListener): Unsubscribe

  /** 연결 상태 변경을 관찰할 listener를 등록한다. */
  subscribeConnectionState(
    listener: (event: SerialConnectionStateEvent) => void,
  ): Unsubscribe

  /** browser event listener를 포함한 transport의 모든 resource를 영구 해제한다. */
  dispose(): Promise<void>
}
