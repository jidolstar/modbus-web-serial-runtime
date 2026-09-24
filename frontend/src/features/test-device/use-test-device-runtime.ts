import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { DynamicDeviceRuntime, type DeviceRuntimeSnapshot } from '../../application/dynamic-device-runtime'
import { ConfigurationStatus, DeviceConfigurator, type ConfigurationResult } from '../../application/device-configurator'
import { DeviceActionRunner } from '../../application/device-action-runner'
import { RUNTIME_CONFIG } from '../../application/runtime-config'
import { SensorMonitor } from '../../application/sensor-monitor'
import type { TestDevice } from '../../application/test-device'
import { testBusSession } from '../../application/test-bus-session'
import type { CatalogDetail } from '../../device-catalog/catalog-api'
import { ModbusFrameDirection } from '../../modbus/modbus-types'
import { ModbusExceptionError, ModbusTimeoutError } from '../../modbus/modbus-errors'
import { RecipeAbortedError, RecipeExecutionError } from '../../recipe-engine/recipe-execution-errors'
import { SerialConnectionState } from '../../serial/serial-connection-state'
import { findErrorCause, OperationAbortedError } from '../../application/operation-errors'

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
export function useTestDeviceRuntime(
  device: Ref<TestDevice>,
  catalogDetail: CatalogDetail,
  onDeviceChanged: (device: TestDevice) => void,
) {
  const { transport: serialTransport, modbusClient, catalog: deviceCatalog, recipeExecutor } = testBusSession
  const sensorMonitor = new SensorMonitor(recipeExecutor, RUNTIME_CONFIG.sensorPollIntervalMs)
  const runtime = new DynamicDeviceRuntime(deviceCatalog, serialTransport, sensorMonitor)
  const snapshot = ref<DeviceRuntimeSnapshot>(runtime.snapshot)
  const measurementRecipeIds = catalogDetail.definition.profile.recipes.measurements ?? []
  const recipesById = new Map(catalogDetail.definition.recipes.map((recipe) => [recipe.id, recipe]))
  const selectedRecipeId = ref(measurementRecipeIds[0] ?? '')
  const lastTx = ref('')
  const lastRx = ref('')
  const operationBusy = ref(false)
  const operationMessage = ref<string | null>(null)
  const operationError = ref<string | null>(null)
  let operationController: AbortController | null = null
  const configurator = new DeviceConfigurator(deviceCatalog, recipeExecutor, serialTransport)
  const actionRunner = new DeviceActionRunner(deviceCatalog, recipeExecutor)

  const unsubscribeRuntime = runtime.subscribe((next) => { snapshot.value = next })
  const unsubscribeFrames = modbusClient.subscribeFrames((event) => {
    if (event.direction === ModbusFrameDirection.Transmit) lastTx.value = toHex(event.frame)
    if (event.direction === ModbusFrameDirection.Receive) lastRx.value = toHex(event.frame)
  })

  const measurementOptions = Object.freeze(measurementRecipeIds.map((id) => Object.freeze({ id, name: recipesById.get(id)?.name ?? id })))
  const actionRecipes = Object.freeze((catalogDetail.definition.profile.recipes.actions ?? []).map((id) => recipesById.get(id)).filter((recipe) => recipe !== undefined))
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

  function applyConfigurationResult(result: ConfigurationResult): void {
    const labels: Readonly<Record<ConfigurationStatus, string>> = {
      [ConfigurationStatus.Verified]: '새 설정에서 장비 응답을 확인했습니다.',
      [ConfigurationStatus.PowerCycleRequired]: '쓰기 완료. 장비 전원을 다시 켠 뒤 새 설정을 확인해 주세요.',
      [ConfigurationStatus.WriteFailed]: '장비가 쓰기 요청을 거부했습니다.',
      [ConfigurationStatus.VerificationFailed]: '변경 후 장비 응답을 확인하지 못했습니다.',
      [ConfigurationStatus.RecoveredOnPreviousConfig]: '변경을 확인하지 못해 이전 통신 설정으로 복구했습니다.',
      [ConfigurationStatus.DeviceStateUnknown]: '장비의 현재 설정을 확인할 수 없습니다. 다시 Scan하거나 수동으로 확인해 주세요.',
    }
    operationMessage.value = labels[result.status]
    if (result.failedStepId) operationMessage.value += ` 실패 단계: ${result.failedStepId}`
    if (result.currentContext && result.status === ConfigurationStatus.Verified) {
      onDeviceChanged(Object.freeze({ ...device.value, slaveId: result.currentContext.slaveId, serialConfig: result.currentContext.serialConfig }))
    }
  }

  /** polling을 중단하고 단일 설정 작업을 실행한 뒤 확인된 context에서만 측정을 재개한다. */
  async function runConfiguration(kind: 'slaveId' | 'baudRate', target: number): Promise<void> {
    if (!isConnected.value || operationBusy.value) return
    operationBusy.value = true; operationMessage.value = null; operationError.value = null
    operationController = new AbortController(); runtime.pauseMeasurement()
    const current = { profileId: device.value.catalogKey, slaveId: device.value.slaveId, serialConfig: device.value.serialConfig }
    try {
      const result = kind === 'slaveId'
        ? await configurator.changeSlaveId(current, target, operationController.signal)
        : await configurator.changeBaudRate(current, target, operationController.signal)
      applyConfigurationResult(result)
      if (result.currentContext) runtime.resumeMeasurement({ profileId: current.profileId, slaveId: result.currentContext.slaveId, baudRate: result.currentContext.serialConfig.baudRate, measurementRecipeId: selectedRecipeId.value, requestPort: false })
    } catch (error) {
      operationError.value = error instanceof Error ? error.message : '장비 설정 작업에 실패했습니다.'
      runtime.resumeMeasurement()
    } finally { operationBusy.value = false; operationController = null }
  }

  async function runAction(recipeId: string, parameters: Readonly<Record<string, unknown>>): Promise<void> {
    if (!isConnected.value || operationBusy.value) return
    operationBusy.value = true; operationMessage.value = null; operationError.value = null
    operationController = new AbortController(); runtime.pauseMeasurement()
    try {
      const result = await actionRunner.execute(device.value.catalogKey, recipeId, device.value.slaveId, parameters, operationController.signal)
      const outputText = Object.values(result.outputs).map(({ display }) => `${display.text}${display.unit ? ` ${display.unit}` : ''}`).join(', ')
      operationMessage.value = outputText ? `작업을 완료했습니다. 결과: ${outputText}` : '작업을 완료하고 장비 응답을 확인했습니다.'
    } catch (error) {
      const failedStep = error instanceof RecipeExecutionError && error.stepId ? ` 실패 단계: ${error.stepId}` : ''
      if (operationController?.signal.aborted || error instanceof RecipeAbortedError || error instanceof OperationAbortedError) {
        operationError.value = `작업을 취소했습니다.${failedStep}`
      } else if (findErrorCause(error, ModbusExceptionError)) {
        operationError.value = `장비가 쓰기 요청을 거부했습니다.${failedStep}`
      } else if (findErrorCause(error, ModbusTimeoutError)) {
        operationError.value = `장비 응답이 없어 적용 여부를 확인할 수 없습니다. 다시 측정하거나 Scan해 주세요.${failedStep}`
      } else {
        operationError.value = `작업 실패로 장비 상태를 확인할 수 없습니다.${failedStep}`
      }
    } finally {
      runtime.resumeMeasurement(); operationBusy.value = false; operationController = null
    }
  }

  function cancelOperation(): void { operationController?.abort('사용자가 작업을 취소했습니다.') }

  onMounted(() => { void runtime.initialize().catch(() => undefined) })
  onBeforeUnmount(() => {
    unsubscribeFrames(); unsubscribeRuntime(); runtime.dispose()
  })

  return {
    connect, connectionLabel: computed(() => CONNECTION_LABELS[snapshot.value.connectionState]), disconnect,
    errorMessage: computed(() => snapshot.value.error?.message ?? null), isConnected, isSupported: serialTransport.isSupported,
    actionRecipes, cancelOperation, isTransitioning, lastRx, lastTx, lastUpdatedAt, measurementOptions,
    operationBusy, operationError, operationMessage, outputs, runAction, runConfiguration,
    selectMeasurement, selectedRecipeId,
  }
}
