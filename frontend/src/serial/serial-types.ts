/** Web Serial API가 지원하는 parity 설정이다. */
export enum SerialParity {
  None = 'none',
  Even = 'even',
  Odd = 'odd',
}

/** Web Serial API가 지원하는 flow control 설정이다. */
export enum SerialFlowControl {
  None = 'none',
  Hardware = 'hardware',
}

/** Serial Port를 열 때 필요한 통신 설정이다. */
export interface SerialConfig {
  /** 초당 전송하는 symbol 수다. 장비 Profile에서 결정한다. */
  readonly baudRate: number

  /** 문자 하나를 구성하는 data bit 수다. */
  readonly dataBits: 7 | 8

  /** 문자 사이에 사용하는 stop bit 수다. */
  readonly stopBits: 1 | 2

  /** 전송 오류를 확인하기 위한 parity 방식이다. */
  readonly parity: SerialParity

  /** 송수신 흐름을 제어하는 방식이다. RS485 장비는 일반적으로 none을 사용한다. */
  readonly flowControl: SerialFlowControl
}

/** 수신 byte chunk를 전달받는 callback이다. */
export type SerialDataListener = (receivedBytes: Uint8Array) => void

/** 등록했던 event listener를 제거하는 함수다. */
export type Unsubscribe = () => void
