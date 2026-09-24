import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { DynamicDeviceRuntime, type DeviceRuntimeSnapshot } from '../../application/dynamic-device-runtime'
import { RUNTIME_CONFIG } from '../../application/runtime-config'
import { SensorMonitor } from '../../application/sensor-monitor'
import { ApiDeviceCatalog } from '../../device-catalog/api-device-catalog'
import { ModbusRtuClient } from '../../modbus/modbus-rtu-client'
import { ModbusFrameDirection } from '../../modbus/modbus-types'
import { RecipeExecutor } from '../../recipe-engine/recipe-executor'
import { SerialConnectionState } from '../../serial/serial-connection-state'
import { WebSerialTransport } from '../../serial/web-serial-transport'

/** 현재 화면에서 선택한 Device Profile ID다. 장비 정의 자체는 runtime JSON에 있다. */
const ACTIVE_DEVICE_PROFILE_ID = 'cwt-th04s'

/** 현재 실장비에 사용자가 설정한 Slave ID다. */
const ACTIVE_DEVICE_SLAVE_ID = 1

/** 현재 실장비에 사용자가 설정한 baudrate다. */
const ACTIVE_DEVICE_BAUD_RATE = 4_800 // 대시보드 CWT-TH04S 연결에 적용할 현장 baudrate. 예: 4800

/** 밀리초 설정을 화면의 초 단위 설명으로 변환할 때 사용하는 단위값이다. */
const MILLISECONDS_PER_SECOND = 1_000

/** 화면이 표시하는 measurement output의 Profile 공통 이름이다. */
const TEMPERATURE_OUTPUT_NAME = 'temperature'

/** 화면이 표시하는 humidity output의 Profile 공통 이름이다. */
const HUMIDITY_OUTPUT_NAME = 'humidity'

/** Serial 상태 enum을 사용자에게 보여줄 한국어 label로 변환하는 고정표다. */
const CONNECTION_LABELS: Readonly<Record<SerialConnectionState, string>> = Object.freeze({
  [SerialConnectionState.Idle]: '연결 안 됨',
  [SerialConnectionState.RequestingPort]: '포트 선택 중',
  [SerialConnectionState.Opening]: '연결 중',
  [SerialConnectionState.Connected]: '연결됨',
  [SerialConnectionState.Reconfiguring]: '통신 설정 변경 중',
  [SerialConnectionState.Closing]: '연결 해제 중',
  [SerialConnectionState.Disconnected]: '장치 분리됨',
  [SerialConnectionState.Faulted]: '통신 오류',
})

/** byte 배열을 현장 확인용 공백 구분 대문자 16진수로 변환한다. */
function toHex(data: Uint8Array): string {
  return [...data]
    .map((currentByte) => currentByte.toString(16).padStart(2, '0').toUpperCase())
    .join(' ')
}

/**
 * CWT 온습도 화면과 generic DynamicDeviceRuntime 사이를 연결하는 Vue adapter다.
 *
 * 통신 객체의 생성과 폐기를 이 composable에 모아 App.vue가 protocol 세부사항이나
 * polling timer를 직접 소유하지 않도록 한다.
 */
export function useCwtTh04sRuntime() {
  /** App 수명 동안 browser Serial Port를 단독 소유하는 transport다. */
  const serialTransport = new WebSerialTransport()

  /** 모든 Modbus transaction을 하나씩 처리하는 RTU client다. */
  const modbusClient = new ModbusRtuClient(
    serialTransport,
    RUNTIME_CONFIG.modbusTransactionTimeoutMs,
  )

  /** Backend의 활성 Profile/Recipe snapshot을 검증해 제공하는 Runtime Catalog다. */
  const deviceCatalog = new ApiDeviceCatalog()

  /** Catalog Recipe를 제한된 Step 집합으로 실행하는 generic 실행기다. */
  const recipeExecutor = new RecipeExecutor(deviceCatalog, modbusClient, serialTransport)

  /** 3초 순차 polling session을 관리하는 monitor다. */
  const sensorMonitor = new SensorMonitor(recipeExecutor, RUNTIME_CONFIG.sensorPollIntervalMs)

  /** 연결, Catalog와 monitor의 application lifecycle을 조정한다. */
  const deviceRuntime = new DynamicDeviceRuntime(deviceCatalog, serialTransport, sensorMonitor)

  /** Runtime snapshot을 Vue 반응형 상태로 연결한다. */
  const runtimeSnapshot = ref<DeviceRuntimeSnapshot>(deviceRuntime.snapshot)

  /** 최근 통신 frame을 기존 진단 UI에 노출하기 위한 문자열 상태다. */
  const lastTx = ref('')
  const lastRx = ref('')

  /** Runtime과 frame 구독을 component 종료 시 해제하기 위한 함수다. */
  const unsubscribeRuntime = deviceRuntime.subscribe((snapshot) => { runtimeSnapshot.value = snapshot })
  const unsubscribeFrames = modbusClient.subscribeFrames((event) => {
    if (event.direction === ModbusFrameDirection.Transmit) lastTx.value = toHex(event.frame)
    if (event.direction === ModbusFrameDirection.Receive) lastRx.value = toHex(event.frame)
  })

  /** template에서 사용하는 상태와 named output의 파생 값이다. */
  const isSupported = serialTransport.isSupported
  const isConnected = computed(
    () => runtimeSnapshot.value.connectionState === SerialConnectionState.Connected,
  )
  const isConnectionTransitioning = computed(() => [
    SerialConnectionState.RequestingPort,
    SerialConnectionState.Opening,
    SerialConnectionState.Closing,
    SerialConnectionState.Reconfiguring,
  ].includes(runtimeSnapshot.value.connectionState))
  const connectionLabel = computed(
    () => CONNECTION_LABELS[runtimeSnapshot.value.connectionState],
  )
  const temperature = computed(
    () => runtimeSnapshot.value.outputs[TEMPERATURE_OUTPUT_NAME]?.value ?? null,
  )
  const humidity = computed(
    () => runtimeSnapshot.value.outputs[HUMIDITY_OUTPUT_NAME]?.value ?? null,
  )
  const lastUpdatedAt = computed(() => (
    runtimeSnapshot.value.lastUpdatedAt?.toLocaleTimeString('ko-KR') ?? null
  ))
  const errorMessage = computed(() => runtimeSnapshot.value.error?.message ?? null)
  const connectionDescription = Object.freeze(
    `${ACTIVE_DEVICE_BAUD_RATE} baud · 8N1 · Slave ID ${ACTIVE_DEVICE_SLAVE_ID} · ${RUNTIME_CONFIG.sensorPollIntervalMs / MILLISECONDS_PER_SECOND}초 간격`,
  )

  /** 사용자 클릭을 현재 선택된 Profile instance 연결 요청으로 변환한다. */
  async function connect(): Promise<void> {
    if (!isSupported || isConnected.value || isConnectionTransitioning.value) return
    try {
      await deviceRuntime.connect({
        profileId: ACTIVE_DEVICE_PROFILE_ID,
        slaveId: ACTIVE_DEVICE_SLAVE_ID,
        baudRate: ACTIVE_DEVICE_BAUD_RATE,
      })
    } catch {
      // Runtime snapshot에 구체적인 오류가 이미 반영되므로 event handler에서는 재전파하지 않는다.
    }
  }

  /** 사용자 요청으로 polling session과 port를 정상 종료한다. */
  async function disconnect(): Promise<void> {
    try {
      await deviceRuntime.disconnect()
    } catch {
      // transport 상태 event가 오류를 snapshot에 반영한다.
    }
  }

  onMounted(() => {
    void deviceRuntime.initialize().catch(() => {
      // 초기 Catalog 오류는 runtimeSnapshot.error를 통해 화면에 표시된다.
    })
  })

  onBeforeUnmount(() => {
    unsubscribeFrames()
    unsubscribeRuntime()
    deviceRuntime.dispose()
    modbusClient.dispose()
    void serialTransport.dispose()
  })

  return {
    connectionDescription,
    connectionLabel,
    connect,
    disconnect,
    errorMessage,
    humidity,
    isConnected,
    isConnectionTransitioning,
    isSupported,
    lastRx,
    lastTx,
    lastUpdatedAt,
    temperature,
  }
}
