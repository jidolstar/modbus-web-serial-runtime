<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue'
import { DeviceActionRunner } from '../application/device-action-runner'
import { TestGroupRunner, type TestGroupRunSnapshot } from '../application/test-group-runner'
import { testBusSession } from '../application/test-bus-session'
import { RecipeKind, RecipeStepType, STANDARD_DEVICE_ID_PARAMETER, type Recipe, type RecipeParameter } from '../device-catalog/recipe.types'
import type { AppRoute } from '../device-catalog/catalog-route'
import { testGroupApi, type TestGroupNode, type TestGroupRuntimeSnapshot } from '../test-groups/test-group-api'
import { SerialConnectionState } from '../serial/serial-connection-state'
import { ModbusExceptionError, ModbusTimeoutError } from '../modbus/modbus-errors'
import { SerialDisconnectedError } from '../serial/serial-errors'
import { findErrorCause } from '../application/operation-errors'

const props = defineProps<{ readonly groupId: number }>(); const emit = defineEmits<{ navigate: [route: AppRoute] }>()
const runtime = ref<TestGroupRuntimeSnapshot | null>(null); const runState = ref<TestGroupRunSnapshot>({ running: false, completed: 0, total: 0, results: [] }); const connected = ref(false); const error = ref<string | null>(null); const operationBusy = ref(false)
const runner = new TestGroupRunner(testBusSession.recipeExecutor); const unsubscribe = runner.subscribe((snapshot) => { runState.value = snapshot })
const unsubscribeConnection = testBusSession.transport.subscribeConnectionState(({ currentState }) => { connected.value = currentState === SerialConnectionState.Connected })
const writeNode = ref<TestGroupNode | null>(null); const selectedAction = ref(''); const values = reactive<Record<string, string | number>>({}); const writeMessage = ref<string | null>(null)
const selectedBundle = computed(() => writeNode.value && runtime.value ? runtime.value.catalogs[writeNode.value.catalogKey] : null)
const actionChoices = computed(() => { const bundle = selectedBundle.value; if (!bundle) return []; const recipes = new Map(bundle.recipes.map((recipe) => [recipe.id, recipe])); const choices: Array<{ id: string; name: string; disabled?: boolean; reason?: string }> = []; if (bundle.profile.recipes.changeSlaveId) choices.push({ id: 'changeSlaveId', name: 'Slave ID 변경', disabled: true, reason: '변경 후 장비별 적용 절차와 전체 bus 재연결이 필요합니다.' }); if (bundle.profile.recipes.changeBaudRate) choices.push({ id: 'changeBaudRate', name: 'Baudrate 변경', disabled: true, reason: 'Group 공통 baudrate는 node 한 대에서 변경할 수 없습니다.' }); for (const id of bundle.profile.recipes.actions ?? []) { const recipe = recipes.get(id); if (recipe?.kind === RecipeKind.Configuration && recipe.steps.some(({ type }) => type === RecipeStepType.WriteSingleRegister)) choices.push({ id, name: recipe.name }) } return choices })
const selectedRecipe = computed<Recipe | null>(() => { const bundle = selectedBundle.value; if (!bundle || !selectedAction.value || selectedAction.value === 'changeSlaveId' || selectedAction.value === 'changeBaudRate') return null; return bundle.recipes.find(({ id }) => id === selectedAction.value) ?? null })
const slaveRange = computed(() => selectedBundle.value?.profile.slave ?? { minId: 1, maxId: 247 })
const visibleParameters = computed<readonly RecipeParameter[]>(() => selectedRecipe.value?.parameters?.filter(({ name }) => name !== STANDARD_DEVICE_ID_PARAMETER) ?? [])
const progress = computed(() => runState.value.total ? Math.round(runState.value.completed / runState.value.total * 100) : 0)

async function load(): Promise<TestGroupRuntimeSnapshot | null> { try { const loaded = await testGroupApi.runtime(props.groupId); runtime.value = loaded; return loaded } catch { error.value = '실행할 테스트 그룹을 불러오지 못했습니다.'; return null } }
async function connect(): Promise<void> { if (!runtime.value || operationBusy.value) return; operationBusy.value = true; try { await testBusSession.catalog.load(); await testBusSession.requestPort(); await testBusSession.transport.open(runtime.value.group.serialConfig); connected.value = true } catch { error.value = '테스트 버스 연결에 실패했습니다.' } finally { operationBusy.value = false } }
async function runAll(): Promise<void> { if (!runtime.value || !connected.value || runState.value.running || operationBusy.value) return; writeMessage.value = null; await runner.run(runtime.value) }
async function runNode(nodeId: number): Promise<void> { if (!runtime.value || !connected.value || runState.value.running || operationBusy.value) return; await runner.runNode(runtime.value, nodeId) }
async function disconnect(): Promise<void> { runner.cancel(); await testBusSession.close(); connected.value = false }
function resultFor(nodeId: number) { return runState.value.results.find((item) => item.nodeId === nodeId) }
function openWrite(node: TestGroupNode): void { writeNode.value = node; selectedAction.value = ''; writeMessage.value = null; for (const key of Object.keys(values)) delete values[key] }
function actionChanged(): void { for (const key of Object.keys(values)) delete values[key]; if (selectedAction.value === 'changeSlaveId') { values.targetId = writeNode.value?.slaveId ?? 1; return } for (const parameter of visibleParameters.value) values[parameter.name] = parameter.type === 'integer' ? parameter.minimum : parameter.values[0] }
function validParameter(parameter: RecipeParameter): boolean { const value = values[parameter.name]; return parameter.type === 'integer' ? Number.isInteger(value) && Number(value) >= parameter.minimum && Number(value) <= parameter.maximum : parameter.values.includes(value) }
async function executeWrite(): Promise<void> {
  const snapshot = runtime.value; const node = writeNode.value; if (!snapshot || !node || !selectedAction.value || visibleParameters.value.some((parameter) => !validParameter(parameter))) return
  operationBusy.value = true; writeMessage.value = null
  try {
    if (selectedAction.value === 'changeSlaveId' || selectedAction.value === 'changeBaudRate') {
      writeMessage.value = '표준 통신 설정 변경은 Device Connection 화면에서 장비별 적용 절차와 재연결로 실행해 주세요.'
      return
    } else {
      await new DeviceActionRunner(testBusSession.catalog, testBusSession.recipeExecutor).execute(node.catalogKey, selectedAction.value, node.slaveId, { ...values }); await runner.runNode(snapshot, node.id); writeMessage.value = '쓰기 작업 후 node를 다시 측정했습니다.'
    }
    writeNode.value = null
  } catch (caught) { writeMessage.value = findErrorCause(caught, ModbusExceptionError) ? '장비가 쓰기 요청을 거부했습니다.' : findErrorCause(caught, ModbusTimeoutError) ? '응답이 없어 적용 여부를 확인할 수 없습니다. 저장값은 변경하지 않았습니다.' : findErrorCause(caught, SerialDisconnectedError) ? 'Serial 연결이 끊어져 작업을 중단했습니다.' : '쓰기 후 장비 상태를 확인하지 못했습니다. 저장값은 변경하지 않았습니다.' } finally { operationBusy.value = false }
}
onMounted(load); onBeforeUnmount(() => { runner.cancel(); unsubscribe(); unsubscribeConnection(); void testBusSession.close() })
</script>
<template>
  <header class="page-heading detail-page-heading"><div><button class="text-link" type="button" @click="emit('navigate', { page: 'test-group-list' })">← 그룹 목록</button><p class="eyebrow">TEST GROUP RUN</p><h1>{{ runtime?.group.name ?? '테스트 그룹 실행' }}</h1><p v-if="runtime" class="description">{{ runtime.group.nodes.length }}개 node · {{ runtime.group.serialConfig.baudRate.toLocaleString() }} baud</p></div><div class="page-heading-actions"><button class="button button-ghost" type="button" @click="emit('navigate', { page: 'test-group-edit', groupId })">수정</button><button v-if="!connected" class="button button-primary" type="button" :disabled="operationBusy" @click="connect">테스트 버스 연결</button><button v-else class="button button-secondary" type="button" @click="disconnect">연결 해제</button></div></header>
  <p v-if="error" class="notice error">{{ error }}</p><p v-if="writeMessage" class="notice" role="status">{{ writeMessage }}</p>
  <section v-if="runtime" class="surface-card group-run-panel"><div class="group-run-toolbar"><div><strong>전체 진행 {{ runState.completed }}/{{ runState.total || runtime.group.nodes.length }}</strong><progress :value="progress" max="100" /></div><div class="inline-actions"><button v-if="runState.running" class="button button-secondary" type="button" @click="runner.cancel">전체 취소</button><button v-else class="button button-primary" type="button" :disabled="!connected || operationBusy" @click="runAll">전체 순차 측정</button></div></div>
    <div class="group-run-list" role="table" aria-label="테스트 node 실행 결과"><div class="group-run-head" role="row"><span>순서</span><span>테스트 장비</span><span>통신 대상</span><span>상태와 최근 결과</span><span>동작</span></div><article v-for="node in runtime.group.nodes" :key="node.id" class="group-run-row" :class="resultFor(node.id)?.status" role="row"><span class="group-run-order">{{ node.position + 1 }}</span><div><strong>{{ node.name }}</strong><small>{{ node.catalogKey }} · revision {{ node.catalogRevision }}</small></div><div><strong>Slave ID {{ node.slaveId }}</strong><small>{{ runtime.group.serialConfig.baudRate.toLocaleString() }} baud</small></div><div><span class="status-pill" :class="resultFor(node.id)?.status === 'succeeded' ? 'success' : resultFor(node.id)?.status === 'running' ? 'progress' : resultFor(node.id) ? 'warning' : 'muted'">{{ resultFor(node.id)?.status ?? '대기' }}</span><p v-if="resultFor(node.id)?.message">{{ resultFor(node.id)?.message }}</p><p v-else-if="resultFor(node.id)?.outputs">{{ Object.entries(resultFor(node.id)?.outputs ?? {}).map(([name, output]) => `${name}: ${output.display.text}${output.display.unit ?? ''}`).join(' · ') || '-' }}</p></div><div class="inline-actions"><button class="button button-ghost button-small" type="button" :disabled="!connected || runState.running || operationBusy" @click="runNode(node.id)">재측정</button><button class="button button-ghost button-small" type="button" :disabled="runState.running || operationBusy || resultFor(node.id)?.status !== 'succeeded'" @click="openWrite(node)">쓰기 작업</button></div></article></div>
  </section>
  <dialog v-if="writeNode" open class="test-device-dialog">
    <form class="test-device-modal" @submit.prevent="executeWrite">
      <header><div><p class="eyebrow">NODE WRITE</p><h2>{{ writeNode.name }} 쓰기 작업</h2><p>대상 Slave ID {{ writeNode.slaveId }} · Catalog {{ writeNode.catalogKey }}</p></div><button class="dialog-close" type="button" aria-label="닫기" @click="writeNode = null">×</button></header>
      <div class="test-device-fields">
        <label>작업<select v-model="selectedAction" required @change="actionChanged"><option value="" disabled>작업 선택</option><option v-for="choice in actionChoices" :key="choice.id" :value="choice.id" :disabled="choice.disabled">{{ choice.name }}{{ choice.reason ? ` — ${choice.reason}` : '' }}</option></select></label>
        <label v-for="parameter in visibleParameters" :key="parameter.name">{{ parameter.label ?? parameter.name }}<input v-if="parameter.type === 'integer'" v-model.number="values[parameter.name]" type="number" :min="parameter.minimum" :max="parameter.maximum" required /><select v-else v-model="values[parameter.name]"><option v-for="value in parameter.values" :key="String(value)" :value="value">{{ value }}</option></select><small>{{ parameter.type === 'integer' ? `허용 범위: ${parameter.minimum}~${parameter.maximum} 정수` : `허용값: ${parameter.values.join(', ')}` }}</small></label>
        <label v-if="selectedAction === 'changeSlaveId'">새 Slave ID<input v-model.number="values.targetId" type="number" :min="slaveRange.minId" :max="slaveRange.maxId" required /><small>허용 범위: {{ slaveRange.minId }}~{{ slaveRange.maxId }} 정수 · 다른 node와 중복 불가</small></label>
      </div>
      <footer><button class="button button-ghost" type="button" @click="writeNode = null">취소</button><button class="button button-primary" type="submit" :disabled="operationBusy || !selectedAction">대상과 값 확인 후 실행</button></footer>
    </form>
  </dialog>
</template>
