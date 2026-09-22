import type { SerialConfig } from './serial-types'

/** TypeScript DOM library에 아직 포함되지 않은 Web Serial Port의 최소 계약이다. */
export interface BrowserSerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null
  readonly writable: WritableStream<Uint8Array> | null
  open(config: SerialConfig): Promise<void>
  close(): Promise<void>
}

/** 애플리케이션이 실제 사용하는 Web Serial API 부분만 표현한다. */
export interface BrowserSerialApi extends EventTarget {
  requestPort(): Promise<BrowserSerialPort>
  getPorts(): Promise<BrowserSerialPort[]>
}

/** transport가 browser 전역에서 실제로 필요한 serial 속성만 분리한 환경 계약이다. */
export interface WebSerialEnvironment {
  readonly serial?: BrowserSerialApi
}
