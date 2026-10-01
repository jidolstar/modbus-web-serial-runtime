<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { DeviceActionRunner } from '../application/device-action-runner'
import { TEST_GROUP_AUTO_INTERVALS_MS, TestGroupRunner, type TestGroupAutoIntervalMs, type TestGroupNodeResult, type TestGroupRunSnapshot } from '../application/test-group-runner'
import { testBusSession } from '../application/test-bus-session'
import { findErrorCause } from '../application/operation-errors'
import { RecipeKind, RecipeStepType, STANDARD_DEVICE_ID_PARAMETER, type Recipe, type RecipeParameter } from '../device-catalog/recipe.types'
import type { AppRoute } from '../device-catalog/catalog-route'
import { ModbusExceptionError, ModbusTimeoutError } from '../modbus/modbus-errors'
import { SerialConnectionState } from '../serial/serial-connection-state'
import { SerialDisconnectedError } from '../serial/serial-errors'
import { testGroupApi, type TestGroupNode, type TestGroupRuntimeSnapshot } from '../test-groups/test-group-api'

const props = defineProps<{ readonly groupId: number }>()
const emit = defineEmits<{ navigate: [route: AppRoute] }>()

const EMPTY_RUN_STATE: TestGroupRunSnapshot = { mode: 'idle', running: false, completed: 0, total: 0, cycle: 0, currentNodeId: null, nextRunAt: null, results: [] }
const STATUS_LABELS = Object.freeze({ waiting: '대기', running: '측정 중', succeeded: '성공', timeout: '응답 없음', 'modbus-exception': '장비 거부', 'recipe-error': '값 읽기 실패', disconnected: '연결 끊김', cancelled: '취소됨' })

const runtime = ref<TestGroupRuntimeSnapshot | null>(null)
const runState = ref<TestGroupRunSnapshot>(EMPTY_RUN_STATE)
const connected = ref(false)
const resultsFromPreviousConnection = ref(false)
const error = ref<string | null>(null)
const operationBusy = ref(false)
const automaticIntervalMs = ref<TestGroupAutoIntervalMs>(3_000)
const automaticSessionActive = ref(false)

const runner = new TestGroupRunner(testBusSession.recipeExecutor)
const unsubscribe = runner.subscribe((snapshot) => { runState.value = snapshot })
const unsubscribeConnection = testBusSession.transport.subscribeConnectionState(({ currentState }) => {
  const connectionActive = currentState === SerialConnectionState.Connected
  connected.value = connectionActive
  if (!connectionActive && runState.value.results.length > 0) resultsFromPreviousConnection.value = true
  if (!connectionActive && runState.value.running) runner.cancel()
})

const writeNode = ref<TestGroupNode | null>(null)
const writeDialog = ref<HTMLDialogElement | null>(null)
const selectedAction = ref('')
const values = reactive<Record<string, string | number>>({})
const writeMessage = ref<string | null>(null)
const writeConfirmationOpen = ref(false)

const selectedBundle = computed(() => writeNode.value && runtime.value ? runtime.value.catalogs[writeNode.value.catalogKey] : null)
const actionChoices = computed(() => {
  const bundle = selectedBundle.value
  if (!bundle) return []
  const recipes = new Map(bundle.recipes.map((recipe) => [recipe.id, recipe]))
  const choices: Array<{ id: string; name: string; disabled?: boolean; reason?: string }> = []
  if (bundle.profile.recipes.changeSlaveId) choices.push({ id: 'changeSlaveId', name: 'Slave ID 변경', disabled: true, reason: '변경 후 장비별 적용 절차와 전체 bus 재연결이 필요합니다.' })
  if (bundle.profile.recipes.changeBaudRate) choices.push({ id: 'changeBaudRate', name: 'Baudrate 변경', disabled: true, reason: 'Group 공통 baudrate는 node 한 대에서 변경할 수 없습니다.' })
  for (const id of bundle.profile.recipes.actions ?? []) {
    const recipe = recipes.get(id)
    if (recipe?.kind === RecipeKind.Configuration && recipe.steps.some(({ type }) => type === RecipeStepType.WriteSingleRegister)) choices.push({ id, name: recipe.name })
  }
  return choices
})
const selectedRecipe = computed<Recipe | null>(() => {
  const bundle = selectedBundle.value
  if (!bundle || !selectedAction.value || selectedAction.value === 'changeSlaveId' || selectedAction.value === 'changeBaudRate') return null
  return bundle.recipes.find(({ id }) => id === selectedAction.value) ?? null
})
const visibleParameters = computed<readonly RecipeParameter[]>(() => selectedRecipe.value?.parameters?.filter(({ name }) => name !== STANDARD_DEVICE_ID_PARAMETER) ?? [])
const invalidParameters = computed(() => visibleParameters.value.filter((parameter) => !validParameter(parameter)))
const progress = computed(() => runState.value.total ? Math.round(runState.value.completed / runState.value.total * 100) : 0)
const automaticRunning = computed(() => automaticSessionActive.value)
const progressMessage = computed(() => {
  if (runState.value.currentNodeId !== null) return '현재 node를 측정하고 있습니다.'
  if (runState.value.nextRunAt) return `다음 전체 순회 ${formatTime(runState.value.nextRunAt)}`
  return '\u00a0'
})

async function load(): Promise<TestGroupRuntimeSnapshot | null> {
  try { const loaded = await testGroupApi.runtime(props.groupId); runtime.value = loaded; return loaded }
  catch { error.value = '실행할 테스트 그룹을 불러오지 못했습니다.'; return null }
}

/** 사용자 클릭 안에서 port를 선택하고 이전 연결 결과를 비워 현재 장비 응답과 섞이지 않게 한다. */
async function connect(): Promise<void> {
  if (!runtime.value || operationBusy.value) return
  operationBusy.value = true
  error.value = null
  try {
    await testBusSession.catalog.load()
    await testBusSession.requestPort()
    await testBusSession.transport.open(runtime.value.group.serialConfig)
    runner.reset()
    resultsFromPreviousConnection.value = false
    connected.value = true
  } catch { error.value = '테스트 버스 연결에 실패했습니다.' }
  finally { operationBusy.value = false }
}

async function runAll(): Promise<void> { if (runtime.value && connected.value && !runState.value.running && !operationBusy.value) await runner.run(runtime.value) }
async function runNode(nodeId: number): Promise<void> { if (runtime.value && connected.value && !runState.value.running && !operationBusy.value) await runner.runNode(runtime.value, nodeId) }

/** 자동 실행이 끝날 때까지 같은 Promise가 operation lock을 소유하며 오류는 화면 메시지로 제한한다. */
async function startAutomatic(): Promise<void> {
  if (!runtime.value || !connected.value || runState.value.running || operationBusy.value) return
  error.value = null
  automaticSessionActive.value = true
  try { await runner.runAutomatically(runtime.value, automaticIntervalMs.value) }
  catch { error.value = '자동 순차 측정을 시작하지 못했습니다.' }
  finally { automaticSessionActive.value = false }
}

async function disconnect(): Promise<void> {
  runner.cancel()
  await testBusSession.close()
  connected.value = false
  if (runState.value.results.length > 0) resultsFromPreviousConnection.value = true
}

function resultFor(nodeId: number): TestGroupNodeResult | undefined { return runState.value.results.find((item) => item.nodeId === nodeId) }
function statusLabel(result: TestGroupNodeResult | undefined): string { return result ? STATUS_LABELS[result.status] : '대기' }
function formatTime(value: Date | null | undefined): string { return value ? new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(value) : '' }
function outputEntries(result: TestGroupNodeResult | undefined) { return Object.entries(result?.outputs ?? {}) }

/** 측정에 성공한 현재 연결의 node만 native modal dialog로 열어 화면 중앙과 focus trap을 보장한다. */
async function openWrite(node: TestGroupNode): Promise<void> {
  if (!connected.value || runState.value.running || resultFor(node.id)?.status !== 'succeeded') return
  writeNode.value = node
  selectedAction.value = ''
  writeMessage.value = null
  writeConfirmationOpen.value = false
  for (const key of Object.keys(values)) delete values[key]
  await nextTick()
  if (!writeDialog.value?.open) writeDialog.value?.showModal()
}

function closeWrite(): void {
  if (writeDialog.value?.open) writeDialog.value.close()
  writeNode.value = null
  writeConfirmationOpen.value = false
}

function handleWriteBackdrop(event: MouseEvent): void { if (event.target === writeDialog.value) closeWrite() }

function actionChanged(): void {
  writeConfirmationOpen.value = false
  for (const key of Object.keys(values)) delete values[key]
  for (const parameter of visibleParameters.value) values[parameter.name] = parameter.type === 'integer' ? parameter.minimum : parameter.values[0]
}

function validParameter(parameter: RecipeParameter): boolean {
  const value = values[parameter.name]
  return parameter.type === 'integer' ? Number.isInteger(value) && Number(value) >= parameter.minimum && Number(value) <= parameter.maximum : parameter.values.includes(value)
}

function prepareWrite(): void {
  if (!selectedAction.value || invalidParameters.value.length > 0) return
  writeConfirmationOpen.value = true
}

/** 최종 확인 뒤에만 장비 write를 실행하고, 성공 시 같은 node를 다시 측정해 현재값을 갱신한다. */
async function executeWrite(): Promise<void> {
  const snapshot = runtime.value
  const node = writeNode.value
  if (!snapshot || !node || !connected.value || !writeConfirmationOpen.value || !selectedAction.value || invalidParameters.value.length > 0) return
  operationBusy.value = true
  writeMessage.value = null
  try {
    await new DeviceActionRunner(testBusSession.catalog, testBusSession.recipeExecutor).execute(node.catalogKey, selectedAction.value, node.slaveId, { ...values })
    await runner.runNode(snapshot, node.id)
    writeMessage.value = '쓰기 작업 후 node를 다시 측정했습니다.'
    closeWrite()
  } catch (caught) {
    writeMessage.value = findErrorCause(caught, ModbusExceptionError) ? '장비가 쓰기 요청을 거부했습니다.' : findErrorCause(caught, ModbusTimeoutError) ? '응답이 없어 적용 여부를 확인할 수 없습니다. 저장값은 변경하지 않았습니다.' : findErrorCause(caught, SerialDisconnectedError) ? 'Serial 연결이 끊어져 작업을 중단했습니다.' : '쓰기 후 장비 상태를 확인하지 못했습니다. 저장값은 변경하지 않았습니다.'
  } finally { operationBusy.value = false }
}

onMounted(load)
onBeforeUnmount(() => { runner.cancel(); unsubscribe(); unsubscribeConnection(); void testBusSession.close() })
</script>

<template>
  <header class="page-heading detail-page-heading">
    <div><p class="eyebrow">TEST GROUP RUN</p><h1>{{ runtime?.group.name ?? '테스트 그룹 실행' }}</h1><p v-if="runtime" class="description">{{ runtime.group.nodes.length }}개 node · {{ runtime.group.serialConfig.baudRate.toLocaleString() }} baud</p></div>
    <div class="page-heading-actions"><button class="button button-ghost" type="button" :disabled="runState.running" @click="emit('navigate', { page: 'test-group-edit', groupId })">수정</button><button v-if="!connected" class="button button-primary" type="button" :disabled="operationBusy" @click="connect">테스트 버스 연결</button><button v-else class="button button-secondary" type="button" :disabled="operationBusy" @click="disconnect">연결 해제</button></div>
  </header>
  <p v-if="error" class="notice error">{{ error }}</p><p v-if="writeMessage" class="notice" role="status">{{ writeMessage }}</p>
  <section v-if="runtime" class="surface-card group-run-panel">
    <div class="group-run-toolbar">
      <div><strong>{{ automaticRunning ? `자동 측정 cycle ${runState.cycle} · ${runState.completed}/${runState.total}` : `전체 진행 ${runState.completed}/${runState.total || runtime.group.nodes.length}` }}</strong><progress :value="progress" max="100" /><small class="group-run-progress-message" aria-live="polite">{{ progressMessage }}</small></div>
      <div class="group-run-controls"><label>전체 순회 후 대기<select v-model.number="automaticIntervalMs" :disabled="runState.running || operationBusy"><option v-for="interval in TEST_GROUP_AUTO_INTERVALS_MS" :key="interval" :value="interval">{{ interval / 1000 }}초</option></select></label><button v-if="automaticRunning" class="button button-secondary" type="button" :disabled="runState.mode === 'stopping'" @click="runner.cancel()">{{ runState.mode === 'stopping' ? '중지 중…' : '자동 측정 중지' }}</button><button v-else-if="runState.running" class="button button-secondary" type="button" :disabled="runState.mode === 'stopping'" @click="runner.cancel()">{{ runState.mode === 'stopping' ? '취소 중…' : '전체 취소' }}</button><button v-else class="button button-primary" type="button" :disabled="!connected || operationBusy" @click="startAutomatic">자동 측정 시작</button><button class="button button-ghost" type="button" :disabled="!connected || runState.running || operationBusy" @click="runAll">전체 순차 측정</button></div>
    </div>
    <p v-if="resultsFromPreviousConnection" class="notice warning">아래 값은 이전 연결의 결과입니다. 다시 연결해 측정하기 전에는 쓰기 작업에 사용할 수 없습니다.</p>
    <div class="group-run-list" role="table" aria-label="테스트 node 실행 결과">
      <div class="group-run-head" role="row"><span>순서</span><span>테스트 장비</span><span>통신 대상</span><span>상태와 최근 결과</span><span>동작</span></div>
      <article v-for="node in runtime.group.nodes" :key="node.id" class="group-run-row" :class="resultFor(node.id)?.status" role="row" :aria-current="runState.currentNodeId === node.id ? 'true' : undefined">
        <span class="group-run-order">{{ node.position + 1 }}</span>
        <div><strong>{{ node.name }}</strong><small>{{ node.catalogKey }} · revision {{ node.catalogRevision }}</small></div>
        <div><strong>Slave ID {{ node.slaveId }}</strong><small>{{ runtime.group.serialConfig.baudRate.toLocaleString() }} baud</small></div>
        <div class="group-run-result"><div><span class="status-pill" :class="resultFor(node.id)?.status === 'succeeded' ? 'success' : resultFor(node.id)?.status === 'running' ? 'progress' : resultFor(node.id) ? 'warning' : 'muted'">{{ statusLabel(resultFor(node.id)) }}</span><small v-if="resultFor(node.id)?.finishedAt">{{ formatTime(resultFor(node.id)?.finishedAt) }} · cycle {{ resultFor(node.id)?.cycle }}</small></div><p v-if="resultFor(node.id)?.message">{{ resultFor(node.id)?.message }}</p><ul v-else-if="outputEntries(resultFor(node.id)).length" class="group-run-outputs"><li v-for="([name, output]) in outputEntries(resultFor(node.id))" :key="name"><span>{{ name }}</span><strong>{{ output.display.text }}{{ output.display.unit ? ` ${output.display.unit}` : '' }}</strong></li></ul><p v-else-if="resultFor(node.id)?.status === 'succeeded'">표시할 측정값이 없습니다.</p></div>
        <div class="inline-actions"><button class="button button-ghost button-small" type="button" :disabled="!connected || runState.running || operationBusy" @click="runNode(node.id)">재측정</button><button class="button button-ghost button-small" type="button" :disabled="!connected || runState.running || operationBusy || resultsFromPreviousConnection || resultFor(node.id)?.status !== 'succeeded'" @click="openWrite(node)">쓰기 작업</button></div>
      </article>
    </div>
  </section>
  <dialog v-if="writeNode" ref="writeDialog" class="test-device-dialog" aria-labelledby="test-group-write-title" @cancel.prevent="closeWrite" @click="handleWriteBackdrop">
    <form class="test-device-modal" @submit.prevent="writeConfirmationOpen ? executeWrite() : prepareWrite()">
      <header><div><p class="eyebrow">NODE WRITE</p><h2 id="test-group-write-title">{{ writeNode.name }} 쓰기 작업</h2><p>대상 Slave ID {{ writeNode.slaveId }} · Catalog {{ writeNode.catalogKey }}</p></div><button class="dialog-close" type="button" aria-label="닫기" @click="closeWrite">×</button></header>
      <div v-if="!writeConfirmationOpen" class="test-device-fields"><label>작업<select v-model="selectedAction" required @change="actionChanged"><option value="" disabled>작업 선택</option><option v-for="choice in actionChoices" :key="choice.id" :value="choice.id" :disabled="choice.disabled">{{ choice.name }}{{ choice.reason ? ` — ${choice.reason}` : '' }}</option></select></label><label v-for="parameter in visibleParameters" :key="parameter.name">{{ parameter.label ?? parameter.name }}<input v-if="parameter.type === 'integer'" v-model.number="values[parameter.name]" type="number" :min="parameter.minimum" :max="parameter.maximum" required /><select v-else v-model="values[parameter.name]"><option v-for="value in parameter.values" :key="String(value)" :value="value">{{ value }}</option></select><small>{{ parameter.type === 'integer' ? `허용 범위: ${parameter.minimum}~${parameter.maximum} 정수` : `허용값: ${parameter.values.join(', ')}` }}</small><small v-if="!validParameter(parameter)" class="field-error">허용된 값을 입력해 주세요.</small></label></div>
      <section v-else class="operation-confirm"><h3>장비에 쓸 내용을 확인해 주세요.</h3><p>{{ writeNode.name }} · Slave ID {{ writeNode.slaveId }} · {{ selectedRecipe?.name }}</p><dl><template v-for="parameter in visibleParameters" :key="parameter.name"><dt>{{ parameter.label ?? parameter.name }}</dt><dd>{{ values[parameter.name] }}</dd></template></dl></section>
      <footer><button class="button button-ghost" type="button" @click="writeConfirmationOpen ? writeConfirmationOpen = false : closeWrite()">{{ writeConfirmationOpen ? '입력으로 돌아가기' : '취소' }}</button><button class="button button-primary" type="submit" :disabled="operationBusy || !selectedAction || invalidParameters.length > 0">{{ writeConfirmationOpen ? '확인하고 실행' : '대상과 값 확인' }}</button></footer>
    </form>
  </dialog>
</template>
