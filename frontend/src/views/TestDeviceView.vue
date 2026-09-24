<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue'
import { createTestDevice, type TestDevice } from '../application/test-device'
import { catalogApi, type CatalogDetail } from '../device-catalog/catalog-api'
import type { AppRoute } from '../device-catalog/catalog-route'
import TestDeviceFormModal from '../features/test-device/TestDeviceFormModal.vue'
import TestDeviceRuntimePanel from '../features/test-device/TestDeviceRuntimePanel.vue'
import { testBusSession } from '../application/test-bus-session'

type RuntimePanel = InstanceType<typeof TestDeviceRuntimePanel>

const props = defineProps<{ readonly route: Extract<AppRoute, { page: 'test-device' }> }>()
const emit = defineEmits<{ navigate: [route: AppRoute] }>()
const catalog = ref<CatalogDetail | null>(null)
const device = ref<TestDevice | null>(null)
const errorMessage = ref<string | null>(null)
const editorOpen = ref(false)
const connectionActive = ref(false)
const connecting = ref(false)
const runtimePanel = ref<RuntimePanel | null>(null)

/** URL은 신뢰하지 않고 Catalog 최신 정의와 revision을 다시 조회한 뒤 TestDevice를 복원한다. */
async function load(): Promise<void> {
  try {
    const loaded = await catalogApi.get(props.route.catalogKey)
    if (!loaded.enabled) throw new Error('비활성 Catalog로 테스트 장비를 실행할 수 없습니다.')
    if (loaded.revision !== props.route.catalogRevision) throw new Error('Catalog가 변경되었습니다. 상세 화면에서 테스트 장비를 다시 만들어 주세요.')
    catalog.value = loaded
    device.value = createTestDevice(loaded, props.route)
    await nextTick()
    if (testBusSession.hasSelectedPort) await connectBus(false)
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : '테스트 장비를 불러오지 못했습니다.' }
}

/** 화면 상단 bus control에서 port 선택과 현재 Test Device 연결을 한 흐름으로 실행한다. */
async function connectBus(requestPort = false): Promise<void> {
  if (connecting.value || connectionActive.value) return
  connecting.value = true
  errorMessage.value = null
  try {
    if (requestPort || !testBusSession.hasSelectedPort) await testBusSession.requestPort()
    await runtimePanel.value?.connect()
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : 'Serial Port 연결에 실패했습니다.' }
  finally { connecting.value = false }
}

async function disconnectBus(): Promise<void> {
  await runtimePanel.value?.disconnect()
}

function save(updated: TestDevice): void {
  editorOpen.value = false
  device.value = updated
  emit('navigate', { page: 'test-device', name: updated.name, catalogKey: updated.catalogKey, catalogRevision: updated.catalogRevision, baudRate: updated.serialConfig.baudRate, slaveId: updated.slaveId, origin: updated.origin })
}

/** 검증된 장비 설정 변경 결과를 화면 context와 URL에 함께 반영한다. */
function applyRuntimeDevice(updated: TestDevice): void { save(updated) }

onMounted(load)
</script>

<template>
  <header class="page-heading detail-page-heading"><div><button class="text-link" type="button" @click="emit('navigate', { page: 'catalog-view', catalogKey: route.catalogKey })">← Catalog로</button><p class="eyebrow">TEST DEVICE</p><h1>{{ device?.name ?? '테스트 장비' }}</h1><p class="description">Catalog가 정의한 측정값을 브라우저에서 주기적으로 확인합니다.</p></div><div v-if="device" class="page-heading-actions"><button class="button button-ghost" type="button" @click="editorOpen = true">테스트 장비 수정</button><button v-if="!connectionActive" class="button button-primary" type="button" :disabled="connecting" @click="connectBus(false)">{{ connecting ? '연결 중…' : '테스트 버스 연결' }}</button><button v-else class="button button-secondary" type="button" @click="disconnectBus">테스트 버스 연결 해제</button></div></header>
  <p v-if="errorMessage" class="notice error">{{ errorMessage }}</p>
  <section v-else-if="device && catalog" class="surface-card test-device-summary">
    <div><span>Catalog</span><strong>{{ catalog.title }}</strong><small>{{ catalog.manufacturer }} · {{ catalog.model }} · revision {{ catalog.revision }}</small></div>
    <div><span>Baudrate</span><strong>{{ device.serialConfig.baudRate.toLocaleString() }}</strong><small>{{ device.serialConfig.dataBits }}{{ device.serialConfig.parity.charAt(0).toUpperCase() }}{{ device.serialConfig.stopBits }}</small></div>
    <div><span>Slave ID</span><strong>{{ device.slaveId }}</strong><small>{{ device.origin === 'scan' ? 'Scan 결과에서 생성' : 'Catalog에서 생성' }}</small></div>
  </section>
  <TestDeviceRuntimePanel v-if="device && catalog" ref="runtimePanel" :device="device" :catalog="catalog" @connection-change="connectionActive = $event" @device-change="applyRuntimeDevice" />
  <TestDeviceFormModal v-if="catalog && device" :open="editorOpen" :catalogs="[catalog]" :initial-device="device" :connection-active="connectionActive" catalog-locked @cancel="editorOpen = false" @save="save" />
</template>
