/** Modbus 계층 오류의 공통 기반 class다. */
export class ModbusError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

/** 설정된 시간 안에 완전한 응답 frame을 받지 못했을 때 발생한다. */
export class ModbusTimeoutError extends ModbusError {}

/** 수신 frame의 CRC가 계산값과 다를 때 발생한다. */
export class ModbusCrcError extends ModbusError {}

/** Slave가 Modbus exception frame으로 응답했을 때 발생한다. */
export class ModbusExceptionError extends ModbusError {
  public constructor(
    message: string,
    public readonly exceptionCode: number,
  ) {
    super(message)
  }
}

/** 응답의 Slave ID, Function Code 또는 payload가 요청과 다를 때 발생한다. */
export class ModbusResponseMismatchError extends ModbusError {}

/** 지원 범위를 벗어난 주소, 개수, 값이 API에 전달됐을 때 발생한다. */
export class ModbusValidationError extends ModbusError {}
