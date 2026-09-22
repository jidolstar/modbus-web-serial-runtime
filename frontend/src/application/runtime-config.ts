/** 센서 폴링 주기의 기본값이다. 운영 환경변수가 없을 때 3초 주기를 사용한다. */
const DEFAULT_SENSOR_POLL_INTERVAL_MS = 3_000

/** Modbus transaction timeout의 기본값이다. 기존 PoC와 같은 1.2초를 사용한다. */
const DEFAULT_MODBUS_TRANSACTION_TIMEOUT_MS = 1_200

/** 지나치게 빠른 반복 요청으로 RS485 bus를 점유하지 않도록 허용하는 최소 폴링 간격이다. */
const MINIMUM_SENSOR_POLL_INTERVAL_MS = 250

/** 화면 기반 실시간 확인 용도에서 허용하는 최대 센서 폴링 간격이다. */
const MAXIMUM_SENSOR_POLL_INTERVAL_MS = 60_000

/** 사용자에게 과도하게 긴 대기 상태를 보이지 않도록 제한하는 최대 transaction timeout이다. */
const MAXIMUM_MODBUS_TRANSACTION_TIMEOUT_MS = 60_000

/** Modbus client가 안전하게 허용하는 transaction timeout 최솟값이다. */
const MINIMUM_MODBUS_TRANSACTION_TIMEOUT_MS = 100

/** 애플리케이션 시작 시 검증을 마친 공개 운영 설정이다. */
export interface RuntimeConfig {
  /** 측정 요청 사이의 시간 간격(ms)이다. */
  readonly sensorPollIntervalMs: number

  /** Modbus 요청 하나가 응답을 기다리는 최대 시간(ms)이다. */
  readonly modbusTransactionTimeoutMs: number
}

/**
 * 문자열 환경변수를 안전한 양의 정수로 변환한다.
 *
 * 잘못된 설정을 조용히 기본값으로 바꾸면 현장 통신 문제를 찾기 어려우므로,
 * 값이 존재하지만 범위를 벗어나면 애플리케이션 시작 단계에서 오류를 발생시킨다.
 */
export function parseIntegerSetting(
  settingName: string,
  rawValue: string | undefined,
  defaultValue: number,
  minimumValue: number,
  maximumValue: number,
): number {
  if (rawValue === undefined || rawValue.trim() === '') return defaultValue

  const parsedValue = Number(rawValue)
  const isValidInteger = Number.isInteger(parsedValue)
  const isWithinRange = parsedValue >= minimumValue && parsedValue <= maximumValue

  if (!isValidInteger || !isWithinRange) {
    throw new Error(
      `${settingName}은(는) ${minimumValue}~${maximumValue} 범위의 정수여야 합니다. 입력값: ${rawValue}`,
    )
  }

  return parsedValue
}

/** Vite 환경변수를 한 번만 읽어 생성한 불변 Runtime 설정이다. */
export const RUNTIME_CONFIG: Readonly<RuntimeConfig> = Object.freeze({
  sensorPollIntervalMs: parseIntegerSetting(
    'VITE_SENSOR_POLL_INTERVAL_MS',
    import.meta.env.VITE_SENSOR_POLL_INTERVAL_MS,
    DEFAULT_SENSOR_POLL_INTERVAL_MS,
    MINIMUM_SENSOR_POLL_INTERVAL_MS,
    MAXIMUM_SENSOR_POLL_INTERVAL_MS,
  ),
  modbusTransactionTimeoutMs: parseIntegerSetting(
    'VITE_MODBUS_TRANSACTION_TIMEOUT_MS',
    import.meta.env.VITE_MODBUS_TRANSACTION_TIMEOUT_MS,
    DEFAULT_MODBUS_TRANSACTION_TIMEOUT_MS,
    MINIMUM_MODBUS_TRANSACTION_TIMEOUT_MS,
    MAXIMUM_MODBUS_TRANSACTION_TIMEOUT_MS,
  ),
})
