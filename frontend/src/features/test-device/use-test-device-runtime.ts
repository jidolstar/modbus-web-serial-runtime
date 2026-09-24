import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { DynamicDeviceRuntime, type DeviceRuntimeSnapshot } from '../../application/dynamic-device-runtime'
import { RUNTIME_CONFIG } from '../../application/runtime-config'
import { SensorMonitor } from '../../application/sensor-monitor'
import type { TestDevice } from '../../application/test-device'
import { testBusSession } from '../../application/test-bus-session'
import type { CatalogDetail } from '../../device-catalog/catalog-api'
import { ModbusFrameDirection } from '../../modbus/modbus-types'
import { SerialConnectionState } from '../../serial/serial-connection-state'

const CONNECTION_LABELS: Readonly<Record<SerialConnectionState, string>> = Object.freeze({
  [SerialConnectionState.Idle]: '연결 안 됨', [SerialConnectionState.RequestingPort]: '포트 선택 중',
  [SerialConnectionState.Opening]: '연결 중', [SerialConnectionState.Connected]: '연결됨',
  [SerialConnectionState.Reconfiguring]: '통신 설정 변경 중', [SerialConnectionState.Closing]: '연결 해제 중',
  [SerialConnectionState.Disconnected]: '장치 분리됨', [SerialConnectionState.Faulted]: '통신 오류',
})

function toHex(data: Uint8Array): string {
  return [...data].map((value) => value.toString(16).padStart(2, '0').toUpperCase()).join(' ')
}

/** TestDeviceView의 한 장비를 Web Serial runtime과 연결하고 component 종료 시 모든 자원을 정리한다. */
export function useTestDeviceRuntime(device: Ref<TestDevice>, catalogDetail: CatalogDetail) {
  const { transport: serialTransport, modbusClient, catalog: deviceCatalog, recipeExecutor } = testBusSession
  const sensorMonitor = new SensorMonitor(recipeExecutor, RUNTIME_CONFIG.sensorPollIntervalMs)
  const runtime = new DynamicDeviceRuntime(deviceCatalog, serialTransport, sensorMonitor)
  const snapshot = ref<DeviceRuntimeSnapshot>(runtime.snapshot)
  const measurementRecipeIds = catalogDetail.definition.profile.recipes.measurements ?? []
  const recipesById = new Map(catalogDetail.definition.recipes.map((recipe) => [recipe.id, recipe]))
  const selectedRecipeId = ref(measurementRecipeIds[0] ?? '')
  const lastTx = ref('')
  const lastRx = ref('')

  const unsubscribeRuntime = runtime.subscribe((next) => { snapshot.value = next })
  const unsubscribeFrames = modbusClient.subscribeFrames((event) => {
    if (event.direction === ModbusFrameDirection.Transmit) lastTx.value = toHex(event.frame)
    if (event.direction === ModbusFrameDirection.Receive) lastRx.value = toHex(event.frame)
  })

  const measurementOptions = Object.freeze(measurementRecipeIds.map((id) => Object.freeze({ id, name: recipesById.get(id)?.name ?? id })))
  const isConnected = computed(() => snapshot.value.connectionState === SerialConnectionState.Connected)
  const isTransitioning = computed(() => [SerialConnectionState.RequestingPort, SerialConnectionState.Opening, SerialConnectionState.Closing, SerialConnectionState.Reconfiguring].includes(snapshot.value.connectionState))
  const outputs = computed(() => {
    return Object.entries(snapshot.value.outputs).map(([name, output]) => Object.freeze({
      name, displayValue: output.display.text, unit: output.display.unit, value: output.value,
    }))
  })
  const lastUpdatedAt = computed(() => snapshot.value.lastUpdatedAt?.toLocaleTimeString('ko-KR') ?? null)

  /** 상위 TestBusSession이 선택한 공유 port를 현재 Test Device 설정으로 열고 polling을 시작한다. */
  async function connect(): Promise<void> {
    if (!serialTransport.isSupported || isConnected.value || isTransitioning.value) return
    try {
      await runtime.connect({ profileId: device.value.catalogKey, slaveId: device.value.slaveId, baudRate: device.value.serialConfig.baudRate, measurementRecipeId: selectedRecipeId.value, requestPort: false })
    } catch { /* Runtime snapshot이 공개 오류를 보관하므로 UI event에서 재전파하지 않는다. */ }
  }

  async function disconnect(): Promise<void> {
    try { await runtime.disconnect() } catch { /* transport 상태 event가 오류를 snapshot에 반영한다. */ }
  }

  function selectMeasurement(): void {
    if (!isConnected.value) return
    try { runtime.selectMeasurement(selectedRecipeId.value) } catch { /* Runtime allowlist 검증 실패 시 기존 연결을 유지한다. */ }
  }

  onMounted(() => { void runtime.initialize().catch(() => undefined) })
  onBeforeUnmount(() => {
    unsubscribeFrames(); unsubscribeRuntime(); runtime.dispose()
  })

  return {
    connect, connectionLabel: computed(() => CONNECTION_LABELS[snapshot.value.connectionState]), disconnect,
    errorMessage: computed(() => snapshot.value.error?.message ?? null), isConnected, isSupported: serialTransport.isSupported,
    isTransitioning, lastRx, lastTx, lastUpdatedAt, measurementOptions, outputs, selectMeasurement, selectedRecipeId,
  }
}
