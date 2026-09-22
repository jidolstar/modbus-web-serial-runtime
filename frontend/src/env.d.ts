/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** 브라우저가 호출할 Backend의 공개 API base URL이다. */
  readonly VITE_API_BASE_URL?: string

  /** 온습도 모니터가 측정 Recipe를 다시 실행하는 간격(ms)이다. */
  readonly VITE_SENSOR_POLL_INTERVAL_MS?: string

  /** Modbus 요청 하나가 응답을 기다리는 최대 시간(ms)이다. */
  readonly VITE_MODBUS_TRANSACTION_TIMEOUT_MS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
