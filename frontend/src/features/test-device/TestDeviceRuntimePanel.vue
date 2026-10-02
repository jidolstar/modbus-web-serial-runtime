<script setup lang="ts">
import { computed, nextTick, reactive, ref, toRef, watch } from 'vue'
import { RecipeStepType, STANDARD_DEVICE_ID_PARAMETER, type Recipe, type RecipeParameter } from '../../device-catalog/recipe.types'
import type { TestDevice } from '../../application/test-device'
import type { CatalogDetail } from '../../device-catalog/catalog-api'
import { useTestDeviceRuntime } from './use-test-device-runtime'

const props = defineProps<{ readonly device: TestDevice; readonly catalog: CatalogDetail }>()
const emit = defineEmits<{ connectionChange: [connected: boolean]; configurationPending: [pending: boolean]; deviceChange: [device: TestDevice] }>()
const runtime = useTestDeviceRuntime(toRef(props, 'device'), props.catalog, (device) => emit('deviceChange', device))
const targetSlaveId = ref(props.device.slaveId)
const targetBaudRate = ref(props.device.serialConfig.baudRate)
const pendingConfirmation = ref<{ type: 'slaveId' | 'baudRate' | 'action'; recipe?: Recipe } | null>(null)
const confirmationDialog = ref<HTMLDialogElement | null>(null)
const actionValues = reactive<Record<string, Record<string, string | number>>>({})
const connectionDescription = computed(() => `${props.device.serialConfig.baudRate.toLocaleString()} baud · ${props.device.serialConfig.dataBits}${props.device.serialConfig.parity.charAt(0).toUpperCase()}${props.device.serialConfig.stopBits} · Slave ID ${props.device.slaveId}`)
watch(runtime.isConnected, (connected) => emit('connectionChange', connected), { immediate: true })
watch(runtime.pendingConfiguration, (pending) => emit('configurationPending', pending !== null), { immediate: true })
watch(() => props.device, (next) => { targetSlaveId.value = next.slaveId; targetBaudRate.value = next.serialConfig.baudRate })
// 확인 상태의 수명에 맞춰 브라우저 모달을 열고 닫아 배경 조작을 막는다.
watch(pendingConfirmation, async (pending) => {
  await nextTick()
  if (pending && confirmationDialog.value && !confirmationDialog.value.open) confirmationDialog.value.showModal()
  else if (!pending && confirmationDialog.value?.open) confirmationDialog.value.close()
})

function visibleActionParameters(recipe: Recipe): readonly RecipeParameter[] {
  return recipe.parameters?.filter(({ name }) => name !== STANDARD_DEVICE_ID_PARAMETER) ?? []
}

function isWriteAction(recipe: Recipe): boolean {
  return recipe.steps.some(({ type }) => type === RecipeStepType.WriteSingleRegister)
}

/** minimum은 검증 경계이지 기본값이 아니므로 정수 입력은 비워 두고 enum만 첫 허용값을 선택한다. */
function ensureActionValues(recipe: Recipe): Record<string, string | number> {
  if (!actionValues[recipe.id]) {
    actionValues[recipe.id] = Object.fromEntries(visibleActionParameters(recipe).map((parameter) => [
      parameter.name, parameter.type === 'integer' ? '' : parameter.values[0],
    ]))
  }
  return actionValues[recipe.id]
}

function parameterRange(parameter: RecipeParameter): string {
  return parameter.type === 'integer'
    ? `허용 범위: ${parameter.minimum.toLocaleString()}~${parameter.maximum.toLocaleString()} 정수`
    : `허용값: ${parameter.values.join(', ')}`
}

function actionParametersValid(recipe: Recipe): boolean {
  const values = ensureActionValues(recipe)
  return visibleActionParameters(recipe).every((parameter) => {
    const value = values[parameter.name]
    return parameter.type === 'integer'
      ? Number.isInteger(value) && Number(value) >= parameter.minimum && Number(value) <= parameter.maximum
      : parameter.values.includes(value)
  })
}

function prepareAction(recipe: Recipe): void {
  if (!actionParametersValid(recipe)) return
  if (isWriteAction(recipe)) pendingConfirmation.value = { type: 'action', recipe }
  else void runtime.runAction(recipe.id, { ...ensureActionValues(recipe) })
}

async function confirmOperation(): Promise<void> {
  const pending = pendingConfirmation.value
  if (!pending) return
  pendingConfirmation.value = null
  if (pending.type === 'slaveId') await runtime.runConfiguration('slaveId', targetSlaveId.value)
  else if (pending.type === 'baudRate') await runtime.runConfiguration('baudRate', targetBaudRate.value)
  else if (pending.recipe) await runtime.runAction(pending.recipe.id, { ...ensureActionValues(pending.recipe) })
}

function closeConfirmation(event: Event): void {
  event.preventDefault()
  pendingConfirmation.value = null
}
for (const recipe of runtime.actionRecipes) ensureActionValues(recipe)
defineExpose({ connect: runtime.connect, disconnect: runtime.disconnect, isConnected: runtime.isConnected, isTransitioning: runtime.isTransitioning })
</script>

<template>
  <section class="sensor-panel surface-card test-device-runtime">
    <header class="sensor-header"><div><p class="eyebrow">LIVE DATA</p><h2>실시간 측정값</h2><p class="description">{{ connectionDescription }}</p></div><span class="status-badge" :class="{ connected: runtime.isConnected.value }"><i />{{ runtime.connectionLabel.value }}</span></header>
    <p v-if="!runtime.isSupported" class="notice error">Web Serial API를 지원하는 데스크톱 Chrome 또는 Edge에서 HTTPS로 접속해 주세요.</p>
    <div v-if="runtime.measurementOptions.length > 1" class="measurement-selector"><label>측정 항목<select v-model="runtime.selectedRecipeId.value" :disabled="runtime.isTransitioning.value" @change="runtime.selectMeasurement"><option v-for="recipe in runtime.measurementOptions" :key="recipe.id" :value="recipe.id">{{ recipe.name }}</option></select></label></div>
    <section class="readings dynamic" aria-live="polite">
      <article v-for="output in runtime.outputs.value" :key="output.name"><span>{{ output.name }}</span><div><strong>{{ output.displayValue }}</strong><small v-if="output.unit">{{ output.unit }}</small></div></article>
      <p v-if="!runtime.outputs.value.length" class="empty-copy">연결하면 Catalog가 정의한 측정값이 여기에 표시됩니다.</p>
    </section>
    <div class="actions"><span class="last-updated">마지막 수신 <strong>{{ runtime.lastUpdatedAt.value ?? '-' }}</strong></span></div>
    <p v-if="runtime.errorMessage.value" class="notice error">{{ runtime.errorMessage.value }}</p>
    <details><summary>최근 Modbus 프레임</summary><dl><dt>TX</dt><dd>{{ runtime.lastTx.value || '-' }}</dd><dt>RX</dt><dd>{{ runtime.lastRx.value || '-' }}</dd></dl></details>
  </section>

  <section v-if="catalog.definition.profile.recipes.changeSlaveId || catalog.definition.profile.recipes.changeBaudRate || runtime.actionRecipes.length" class="surface-card device-operations">
    <header><div><p class="eyebrow">DEVICE OPERATIONS</p><h2>장비 설정과 추가 작업</h2><p class="description">Catalog가 허용한 작업만 표시합니다. 실행 전 대상과 값을 다시 확인합니다.</p></div></header>
    <div class="operation-grid">
      <article v-if="catalog.definition.profile.recipes.changeSlaveId">
        <h3>Slave ID 변경</h3><p>새 주소를 기록한 뒤 현재 연결을 종료합니다. 적용 시점은 장비마다 다를 수 있습니다.</p>
        <label>새 Slave ID<input v-model.number="targetSlaveId" type="number" :min="catalog.definition.profile.slave.minId" :max="catalog.definition.profile.slave.maxId" :disabled="!runtime.isConnected.value || runtime.operationBusy.value || !!runtime.pendingConfiguration.value" /></label>
        <button class="button button-secondary" type="button" :disabled="!runtime.isConnected.value || runtime.operationBusy.value || !!runtime.pendingConfiguration.value || targetSlaveId === device.slaveId" @click="pendingConfirmation = { type: 'slaveId' }">변경 확인</button>
      </article>
      <article v-if="catalog.definition.profile.recipes.changeBaudRate">
        <h3>Baudrate 변경</h3><p>새 통신 속도를 기록한 뒤 현재 연결을 종료합니다. 적용 시점은 장비마다 다를 수 있습니다.</p>
        <label>새 baudrate<select v-model.number="targetBaudRate" :disabled="!runtime.isConnected.value || runtime.operationBusy.value || !!runtime.pendingConfiguration.value"><option v-for="baud in catalog.definition.profile.serial.supportedBaudRates" :key="baud" :value="baud">{{ baud.toLocaleString() }}</option></select></label>
        <button class="button button-secondary" type="button" :disabled="!runtime.isConnected.value || runtime.operationBusy.value || !!runtime.pendingConfiguration.value || targetBaudRate === device.serialConfig.baudRate" @click="pendingConfirmation = { type: 'baudRate' }">변경 확인</button>
      </article>
      <article v-for="recipe in runtime.actionRecipes" :key="recipe.id">
        <h3>{{ recipe.name }}</h3><p>{{ isWriteAction(recipe) ? 'Catalog가 허용한 설정값을 장비에 씁니다.' : 'Catalog가 제공하는 진단값을 한 번 읽습니다.' }}</p>
        <div v-if="visibleActionParameters(recipe).length" class="operation-parameters">
          <label v-for="parameter in visibleActionParameters(recipe)" :key="parameter.name">{{ parameter.label ?? parameter.name }}
            <input v-if="parameter.type === 'integer'" v-model.number="actionValues[recipe.id][parameter.name]" type="number" :min="parameter.minimum" :max="parameter.maximum" :placeholder="`${parameter.minimum}~${parameter.maximum}`" :disabled="runtime.operationBusy.value || !!runtime.pendingConfiguration.value" />
            <select v-else v-model="actionValues[recipe.id][parameter.name]" :disabled="runtime.operationBusy.value || !!runtime.pendingConfiguration.value"><option v-for="value in parameter.values" :key="String(value)" :value="value">{{ value }}</option></select>
            <small>{{ parameterRange(parameter) }}</small>
          </label>
        </div>
        <button class="button button-secondary" type="button" :disabled="!runtime.isConnected.value || runtime.operationBusy.value || !!runtime.pendingConfiguration.value || !actionParametersValid(recipe)" @click="prepareAction(recipe)">{{ isWriteAction(recipe) ? '값 입력 및 확인' : '현재값 읽기' }}</button>
        <div v-if="runtime.actionStates.value[recipe.id]" class="action-result" :class="runtime.actionStates.value[recipe.id].status" :role="runtime.actionStates.value[recipe.id].status === 'failed' ? 'alert' : 'status'" aria-live="polite">
          <p v-if="runtime.actionStates.value[recipe.id].status === 'running'">작업을 실행하고 있습니다.</p>
          <p v-if="runtime.actionStates.value[recipe.id].status === 'succeeded'" class="action-result-heading">{{ isWriteAction(recipe) ? '쓰기 성공 · 장비 응답 확인' : '작업 성공' }}</p>
          <dl v-if="runtime.actionStates.value[recipe.id].outputs.length">
            <template v-for="output in runtime.actionStates.value[recipe.id].outputs" :key="output.name"><dt>{{ output.name }}</dt><dd>{{ output.displayValue }}<small v-if="output.unit"> {{ output.unit }}</small></dd></template>
          </dl>
          <p v-if="runtime.actionStates.value[recipe.id].message">{{ runtime.actionStates.value[recipe.id].message }}</p>
          <small v-if="runtime.actionStates.value[recipe.id].completedAt">마지막 성공 {{ runtime.actionStates.value[recipe.id].completedAt }}</small>
        </div>
      </article>
    </div>
    <dialog v-if="pendingConfirmation" ref="confirmationDialog" class="test-device-dialog device-operation-dialog" aria-labelledby="operation-confirm-title" @cancel="closeConfirmation">
      <section class="operation-confirm">
      <h3 id="operation-confirm-title">장비에 쓰기 전에 확인해 주세요</h3>
      <p><strong>{{ device.name }}</strong> · Slave ID {{ device.slaveId }}에 {{ pendingConfirmation.type === 'slaveId' ? `Slave ID ${targetSlaveId}` : pendingConfirmation.type === 'baudRate' ? `baudrate ${targetBaudRate.toLocaleString()}` : pendingConfirmation.recipe?.name }} 작업을 실행합니다.</p>
      <p v-if="pendingConfirmation.type !== 'action'">쓰기 응답을 받으면 현재 COM 포트 연결을 먼저 종료하고, 새 Slave ID와 baudrate로 화면을 다시 연 뒤 자동 연결합니다. 설정 적용에 전원 재인가가 필요한 장비는 자동 연결에 실패할 수 있습니다.</p>
      <div v-if="pendingConfirmation.recipe" class="operation-parameters">
        <label v-for="parameter in pendingConfirmation.recipe.parameters?.filter(({ name }) => name !== STANDARD_DEVICE_ID_PARAMETER)" :key="parameter.name">{{ parameter.label ?? parameter.name }}
          <input v-if="parameter.type === 'integer'" v-model.number="actionValues[pendingConfirmation.recipe.id][parameter.name]" type="number" :min="parameter.minimum" :max="parameter.maximum" :placeholder="`${parameter.minimum}~${parameter.maximum}`" />
          <select v-else v-model="actionValues[pendingConfirmation.recipe.id][parameter.name]"><option v-for="value in parameter.values" :key="String(value)" :value="value">{{ value }}</option></select>
          <small>{{ parameterRange(parameter) }}</small>
        </label>
      </div>
      <div class="inline-actions"><button class="button button-ghost" type="button" @click="pendingConfirmation = null">취소</button><button class="button button-primary" type="button" @click="confirmOperation">{{ pendingConfirmation.type === 'action' ? '확인하고 실행' : '설정 쓰기' }}</button></div>
      </section>
    </dialog>
    <section v-if="runtime.pendingConfiguration.value" class="operation-confirm" aria-labelledby="reconnect-guide-title">
      <h3 id="reconnect-guide-title">새 설정으로 다시 연결해 확인해 주세요</h3>
      <p v-if="runtime.pendingConfiguration.value.delivery === 'uncertain'" class="notice error" role="alert">쓰기 응답을 받지 못해 설정 적용 여부가 불분명합니다. 새 설정으로 먼저 확인하고, 실패하면 Scan 또는 수동 설정으로 현재값을 찾아주세요.</p>
      <ol>
        <li>장비에 따라 설정이 즉시 적용되거나 재연결 후 적용될 수 있습니다.</li>
        <li>새 설정으로 연결되지 않으면 장비 전원을 완전히 차단했다가 다시 공급합니다.</li>
        <li>아래 버튼을 눌러 USB/Serial 포트를 선택하고 새 설정을 확인합니다.</li>
      </ol>
      <p><strong>확인할 설정:</strong> {{ runtime.pendingConfiguration.value.targetContext.serialConfig.baudRate.toLocaleString() }} baud · Slave ID {{ runtime.pendingConfiguration.value.targetContext.slaveId }}</p>
      <div class="inline-actions"><button class="button button-ghost" type="button" :disabled="runtime.operationBusy.value" @click="runtime.clearPendingConfiguration">미확정 설정 닫기</button><button class="button button-primary" type="button" :disabled="runtime.operationBusy.value" @click="runtime.reconnectPending">새 설정으로 연결</button></div>
    </section>
    <div v-if="runtime.operationBusy.value" class="notice">작업 중에는 측정을 잠시 멈춥니다. <button class="text-link inline" type="button" @click="runtime.cancelOperation">작업 취소</button></div>
    <p v-if="runtime.operationMessage.value" class="notice success" role="status">{{ runtime.operationMessage.value }}</p>
    <p v-if="runtime.operationError.value" class="notice error" role="alert">{{ runtime.operationError.value }}</p>
  </section>
</template>
