import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue'
import { DynamicDeviceRuntime, type DeviceRuntimeSnapshot } from '../../application/dynamic-device-runtime'
import { ConfigurationStatus, DeviceConfigurator, type ConfigurationResult, type DeviceContext } from '../../application/device-configurator'
import { DeviceActionRunner } from '../../application/device-action-runner'
import { RUNTIME_CONFIG } from '../../application/runtime-config'
import { SensorMonitor } from '../../application/sensor-monitor'
import type { TestDevice } from '../../application/test-device'
import { testBusSession } from '../../application/test-bus-session'
import type { CatalogDetail } from '../../device-catalog/catalog-api'
import { RecipeStepType } from '../../device-catalog/recipe.types'
import { ModbusFrameDirection } from '../../modbus/modbus-types'
import { ModbusExceptionError, ModbusTimeoutError } from '../../modbus/modbus-errors'
import { RecipeAbortedError, RecipeExecutionError } from '../../recipe-engine/recipe-execution-errors'
import { SerialConnectionState } from '../../serial/serial-connection-state'
import { findErrorCause, OperationAbortedError } from '../../application/operation-errors'

/** 설정 write 뒤 장비별 적용 절차와 목표값 검증을 기다리는 Test Device 화면 상태다. */
export interface PendingConfiguration {
  readonly kind: 'slaveId' | 'baudRate'
  readonly targetContext: DeviceContext
  readonly delivery: 'acknowledged' | 'uncertain'
}

/** test-device의 각 action 카드가 독립적으로 표시하는 최근 실행 상태다. */
export interface DeviceActionState {
  readonly status: 'running' | 'succeeded' | 'failed'
  readonly outputs: ReadonlyArray<{ readonly name: string; readonly displayValue: string; readonly unit?: string }>
  readonly message?: string
  readonly completedAt?: string
}

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
  const actionStates = ref<Readonly<Record<string, DeviceActionState>>>(Object.freeze({}))
  const pendingConfiguration = ref<PendingConfiguration | null>(null)
  let operationController: AbortController | null = null
  const configurator = new DeviceConfigurator(deviceCatalog, recipeExecutor)
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

  function setActionState(recipeId: string, state: DeviceActionState): void {
    actionStates.value = Object.freeze({ ...actionStates.value, [recipeId]: Object.freeze(state) })
  }

  /** 상위 TestBusSession이 선택한 공유 port를 현재 Test Device 설정으로 열고 polling을 시작한다. */
  async function connect(): Promise<void> {
    if (!serialTransport.isSupported || isConnected.value || isTransitioning.value || pendingConfiguration.value) return
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

  /** 응답이 불확실하거나 거부된 쓰기는 자동 반영하지 않고 사용자가 확인할 상태로 남긴다. */
  function applyUnconfirmedConfigurationResult(kind: 'slaveId' | 'baudRate', result: ConfigurationResult): void {
    if (result.status === ConfigurationStatus.WriteRejected) {
      operationError.value = '장비가 설정 쓰기 요청을 거부했습니다. 현재 설정값은 변경하지 않습니다.'
      if (result.failedStepId) operationError.value += ` 실패 단계: ${result.failedStepId}`
      return
    }
    if (!result.pendingContext) {
      operationError.value = '재연결에 사용할 목표 설정을 만들지 못했습니다.'
      return
    }
    pendingConfiguration.value = Object.freeze({
      kind,
      targetContext: result.pendingContext,
      delivery: result.status === ConfigurationStatus.ReconnectRequired ? 'acknowledged' : 'uncertain',
    })
    operationMessage.value = '통신이 끊겨 설정 적용 여부를 확인할 수 없습니다. 연결을 종료했습니다.'
  }

  /** polling을 중단하고 설정을 한 번 쓴 뒤 기존 port를 닫은 다음 확인된 목표값으로 화면을 다시 연다. */
  async function runConfiguration(kind: 'slaveId' | 'baudRate', target: number): Promise<void> {
    if (!isConnected.value || operationBusy.value) return
    operationBusy.value = true; operationMessage.value = null; operationError.value = null
    operationController = new AbortController(); runtime.pauseMeasurement()
    const current = { profileId: device.value.catalogKey, slaveId: device.value.slaveId, serialConfig: device.value.serialConfig }
    let confirmedTarget: DeviceContext | null = null
    let disconnected = false
    try {
      const result = kind === 'slaveId'
        ? await configurator.changeSlaveId(current, target, operationController.signal)
        : await configurator.changeBaudRate(current, target, operationController.signal)
      if (result.status === ConfigurationStatus.ReconnectRequired && result.pendingContext) {
        confirmedTarget = result.pendingContext
      } else {
        applyUnconfirmedConfigurationResult(kind, result)
      }
    } catch (error) {
      operationError.value = error instanceof Error ? error.message : '장비 설정 작업에 실패했습니다.'
    } finally {
      try { await runtime.disconnect(); disconnected = true }
      catch { operationError.value = `${operationError.value ?? '설정 쓰기 후'} Serial 연결을 정상적으로 종료하지 못했습니다.` }
      operationBusy.value = false; operationController = null
    }
    if (!confirmedTarget) return
    if (!disconnected) {
      pendingConfiguration.value = Object.freeze({ kind, targetContext: confirmedTarget, delivery: 'acknowledged' })
      return
    }

    // 상위 화면이 새 URL로 교체되면 선택된 port를 새 통신값으로 자동 연결한다.
    onDeviceChanged(Object.freeze({
      ...device.value,
      slaveId: confirmedTarget.slaveId,
      serialConfig: confirmedTarget.serialConfig,
    }))
  }

  /** 사용자가 장비별 적용 절차를 마친 뒤 새 port를 선택하고 첫 측정 성공 시에만 TestDevice를 확정한다. */
  async function reconnectPending(): Promise<void> {
    const pending = pendingConfiguration.value
    if (!pending || operationBusy.value) return
    operationBusy.value = true; operationError.value = null
    operationController = new AbortController()
    try {
      await testBusSession.requestPort()
      await runtime.connectAndVerify({
        profileId: pending.targetContext.profileId,
        slaveId: pending.targetContext.slaveId,
        baudRate: pending.targetContext.serialConfig.baudRate,
        measurementRecipeId: selectedRecipeId.value,
        requestPort: false,
      }, operationController.signal)
      onDeviceChanged(Object.freeze({
        ...device.value,
        slaveId: pending.targetContext.slaveId,
        serialConfig: pending.targetContext.serialConfig,
      }))
      pendingConfiguration.value = null
      operationMessage.value = '새 설정에서 장비의 첫 측정 응답을 확인했습니다.'
    } catch (error) {
      operationError.value = error instanceof Error
        ? `새 설정에서 장비 응답을 확인하지 못했습니다: ${error.message}`
        : '새 설정에서 장비 응답을 확인하지 못했습니다.'
      try { await runtime.disconnect() } catch { /* 원래 검증 오류를 유지한다. */ }
    } finally { operationBusy.value = false; operationController = null }
  }

  /** 미확정 목표값을 버리되 장비의 실제 상태를 이전 값으로 단정하지 않는다. */
  function clearPendingConfiguration(): void {
    pendingConfiguration.value = null
    operationMessage.value = '미확정 설정을 닫았습니다. 장비 상태가 불분명하면 Scan 또는 수동 설정으로 확인해 주세요.'
  }

  /** Operation 카드에서 Recipe를 한 번 실행하고 쓰기 응답·측정 결과 또는 실패를 카드별로 남긴다. */
  async function runAction(recipeId: string, parameters: Readonly<Record<string, unknown>>): Promise<void> {
    if (!isConnected.value || operationBusy.value) return
    operationBusy.value = true; operationMessage.value = null; operationError.value = null
    setActionState(recipeId, { status: 'running', outputs: Object.freeze([]) })
    operationController = new AbortController(); runtime.pauseMeasurement()
    try {
      const result = await actionRunner.execute(device.value.catalogKey, recipeId, device.value.slaveId, parameters, operationController.signal)
      const actionOutputs = Object.entries(result.outputs).map(([name, output]) => Object.freeze({
        name, displayValue: output.display.text, unit: output.display.unit,
      }))
      const recipe = recipesById.get(recipeId)
      const isWriteAction = recipe?.steps.some(({ type }) => type === RecipeStepType.WriteSingleRegister) ?? false
      setActionState(recipeId, {
        status: 'succeeded', outputs: Object.freeze(actionOutputs),
        message: actionOutputs.length
          ? undefined
          : isWriteAction
            ? `쓰기 요청의 정상 응답을 확인했습니다. 입력값 ${Object.entries(parameters).map(([name, value]) => `${name}: ${String(value)}`).join(', ')} · 실제 저장값은 현재값 읽기로 확인해 주세요.`
            : '장비 응답을 확인했습니다.',
        completedAt: new Date().toLocaleTimeString('ko-KR'),
      })
    } catch (error) {
      const failedStep = error instanceof RecipeExecutionError && error.stepId ? ` 실패 단계: ${error.stepId}` : ''
      let message: string
      if (operationController?.signal.aborted || error instanceof RecipeAbortedError || error instanceof OperationAbortedError) {
        message = `작업을 취소했습니다.${failedStep}`
      } else if (findErrorCause(error, ModbusExceptionError)) {
        message = `장비가 요청을 거부했습니다.${failedStep}`
      } else if (findErrorCause(error, ModbusTimeoutError)) {
        message = `장비 응답이 없습니다. 연결과 통신 설정을 확인해 주세요.${failedStep}`
      } else {
        message = `작업에 실패해 장비 상태를 확인할 수 없습니다.${failedStep}`
      }
      setActionState(recipeId, { status: 'failed', outputs: Object.freeze([]), message })
    } finally {
      runtime.resumeMeasurement(); operationBusy.value = false; operationController = null
    }
  }

  function cancelOperation(): void { operationController?.abort('사용자가 작업을 취소했습니다.') }

  onMounted(() => { void runtime.initialize().catch(() => undefined) })
  onBeforeUnmount(() => {
    operationController?.abort('화면 이동')
    unsubscribeFrames(); unsubscribeRuntime(); runtime.dispose()
    void testBusSession.close()
  })

  return {
    connect, connectionLabel: computed(() => CONNECTION_LABELS[snapshot.value.connectionState]), disconnect,
    errorMessage: computed(() => snapshot.value.error?.message ?? null), isConnected, isSupported: serialTransport.isSupported,
    actionRecipes, actionStates, cancelOperation, isTransitioning, lastRx, lastTx, lastUpdatedAt, measurementOptions,
    operationBusy, operationError, operationMessage, outputs, pendingConfiguration, reconnectPending,
    clearPendingConfiguration, runAction, runConfiguration,
    selectMeasurement, selectedRecipeId,
  }
}
