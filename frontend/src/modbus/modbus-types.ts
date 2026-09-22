/** 현재 실행 엔진이 지원하는 Modbus Function Code다. */
export enum ModbusFunctionCode {
  ReadHoldingRegisters = 0x03,
  WriteSingleRegister = 0x06,
}

/** raw RTU frame이 전송 또는 수신된 방향이다. */
export enum ModbusFrameDirection {
  Transmit = 'tx',
  Receive = 'rx',
}

/** 통신 모니터가 표시할 수 있도록 공개하는 raw frame event다. */
export interface ModbusFrameEvent {
  /** frame이 전송인지 수신인지 구분한다. */
  readonly direction: ModbusFrameDirection

  /** 외부 변경을 막기 위해 복사된 RTU frame이다. */
  readonly frame: Uint8Array

  /** frame이 관찰된 브라우저 시간이다. */
  readonly timestamp: Date
}

/** Modbus transaction별 선택 설정이다. */
export interface ModbusTransactionOptions {
  /** 기본값 대신 이 요청에만 적용할 timeout(ms)이다. */
  readonly timeoutMs?: number
}

/** Modbus client가 제공하는 최소 public 기능이다. */
export interface ModbusClient {
  /** FC03으로 연속된 Holding Register를 읽는다. */
  readHoldingRegisters(
    slaveId: number,
    address: number,
    count: number,
    options?: ModbusTransactionOptions,
  ): Promise<ReadonlyArray<number>>

  /** FC06으로 Holding Register 하나를 기록하고 echo 응답을 검증한다. */
  writeSingleRegister(
    slaveId: number,
    address: number,
    value: number,
    options?: ModbusTransactionOptions,
  ): Promise<void>
}
