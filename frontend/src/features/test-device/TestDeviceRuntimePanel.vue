<script setup lang="ts">
import { computed, reactive, ref, toRef, watch } from 'vue'
import { STANDARD_DEVICE_ID_PARAMETER, type Recipe } from '../../device-catalog/recipe.types'
import type { TestDevice } from '../../application/test-device'
import type { CatalogDetail } from '../../device-catalog/catalog-api'
import { useTestDeviceRuntime } from './use-test-device-runtime'

const props = defineProps<{ readonly device: TestDevice; readonly catalog: CatalogDetail }>()
const emit = defineEmits<{ connectionChange: [connected: boolean]; deviceChange: [device: TestDevice] }>()
const runtime = useTestDeviceRuntime(toRef(props, 'device'), props.catalog, (device) => emit('deviceChange', device))
const targetSlaveId = ref(props.device.slaveId)
const targetBaudRate = ref(props.device.serialConfig.baudRate)
const pendingConfirmation = ref<{ type: 'slaveId' | 'baudRate' | 'action'; recipe?: Recipe } | null>(null)
const actionValues = reactive<Record<string, string | number>>({})
const connectionDescription = computed(() => `${props.device.serialConfig.baudRate.toLocaleString()} baud · ${props.device.serialConfig.dataBits}${props.device.serialConfig.parity.charAt(0).toUpperCase()}${props.device.serialConfig.stopBits} · Slave ID ${props.device.slaveId}`)
watch(runtime.isConnected, (connected) => emit('connectionChange', connected), { immediate: true })
watch(() => props.device, (next) => { targetSlaveId.value = next.slaveId; targetBaudRate.value = next.serialConfig.baudRate })

function prepareAction(recipe: Recipe): void {
  for (const name of Object.keys(actionValues)) delete actionValues[name]
  for (const parameter of recipe.parameters ?? []) {
    if (parameter.name === STANDARD_DEVICE_ID_PARAMETER) continue
    actionValues[parameter.name] = parameter.type === 'integer' ? parameter.minimum : parameter.values[0]
  }
  pendingConfirmation.value = { type: 'action', recipe }
}

async function confirmOperation(): Promise<void> {
  const pending = pendingConfirmation.value
  if (!pending) return
  pendingConfirmation.value = null
  if (pending.type === 'slaveId') await runtime.runConfiguration('slaveId', targetSlaveId.value)
  else if (pending.type === 'baudRate') await runtime.runConfiguration('baudRate', targetBaudRate.value)
  else if (pending.recipe) await runtime.runAction(pending.recipe.id, { ...actionValues })
}
defineExpose({ connect: runtime.connect, disconnect: runtime.disconnect, isConnected: runtime.isConnected, isTransitioning: runtime.isTransitioning })
</script>

<template>
  <section class="sensor-panel surface-card test-device-runtime">
    <header class="sensor-header"><div><p class="eyebrow">LIVE TEST</p><h2>장비 측정</h2><p class="description">{{ connectionDescription }}</p></div><span class="status-badge" :class="{ connected: runtime.isConnected.value }"><i />{{ runtime.connectionLabel.value }}</span></header>
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
        <h3>Slave ID 변경</h3><p>현재 {{ device.slaveId }}에서 새 주소로 변경하고 응답을 확인합니다.</p>
        <label>새 Slave ID<input v-model.number="targetSlaveId" type="number" :min="catalog.definition.profile.slave.minId" :max="catalog.definition.profile.slave.maxId" :disabled="!runtime.isConnected.value || runtime.operationBusy.value" /></label>
        <button class="button button-secondary" type="button" :disabled="!runtime.isConnected.value || runtime.operationBusy.value || targetSlaveId === device.slaveId" @click="pendingConfirmation = { type: 'slaveId' }">변경 확인</button>
      </article>
      <article v-if="catalog.definition.profile.recipes.changeBaudRate">
        <h3>Baudrate 변경</h3><p>쓰기 후 새 통신 속도에서 장비 응답을 확인합니다.</p>
        <label>새 baudrate<select v-model.number="targetBaudRate" :disabled="!runtime.isConnected.value || runtime.operationBusy.value"><option v-for="baud in catalog.definition.profile.serial.supportedBaudRates" :key="baud" :value="baud">{{ baud.toLocaleString() }}</option></select></label>
        <button class="button button-secondary" type="button" :disabled="!runtime.isConnected.value || runtime.operationBusy.value || targetBaudRate === device.serialConfig.baudRate" @click="pendingConfirmation = { type: 'baudRate' }">변경 확인</button>
      </article>
      <article v-for="recipe in runtime.actionRecipes" :key="recipe.id">
        <h3>{{ recipe.name }}</h3><p>Catalog가 이 장비에 허용한 추가 쓰기 작업입니다.</p>
        <button class="button button-secondary" type="button" :disabled="!runtime.isConnected.value || runtime.operationBusy.value" @click="prepareAction(recipe)">값 입력 및 확인</button>
      </article>
    </div>
    <div v-if="pendingConfirmation" class="operation-confirm" role="region" aria-labelledby="operation-confirm-title">
      <h3 id="operation-confirm-title">장비에 쓰기 전에 확인해 주세요</h3>
      <p><strong>{{ device.name }}</strong> · Slave ID {{ device.slaveId }}에 {{ pendingConfirmation.type === 'slaveId' ? `Slave ID ${targetSlaveId}` : pendingConfirmation.type === 'baudRate' ? `baudrate ${targetBaudRate.toLocaleString()}` : pendingConfirmation.recipe?.name }} 작업을 실행합니다.</p>
      <div v-if="pendingConfirmation.recipe" class="operation-parameters">
        <label v-for="parameter in pendingConfirmation.recipe.parameters?.filter(({ name }) => name !== STANDARD_DEVICE_ID_PARAMETER)" :key="parameter.name">{{ parameter.label ?? parameter.name }}
          <input v-if="parameter.type === 'integer'" v-model.number="actionValues[parameter.name]" type="number" :min="parameter.minimum" :max="parameter.maximum" />
          <select v-else v-model="actionValues[parameter.name]"><option v-for="value in parameter.values" :key="String(value)" :value="value">{{ value }}</option></select>
        </label>
      </div>
      <div class="inline-actions"><button class="button button-ghost" type="button" @click="pendingConfirmation = null">취소</button><button class="button button-primary" type="button" @click="confirmOperation">확인하고 실행</button></div>
    </div>
    <div v-if="runtime.operationBusy.value" class="notice">작업 중에는 측정을 잠시 멈춥니다. <button class="text-link inline" type="button" @click="runtime.cancelOperation">작업 취소</button></div>
    <p v-if="runtime.operationMessage.value" class="notice success" role="status">{{ runtime.operationMessage.value }}</p>
    <p v-if="runtime.operationError.value" class="notice error" role="alert">{{ runtime.operationError.value }}</p>
  </section>
</template>
