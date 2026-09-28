<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { checkTestDeviceCatalogCompatibility, createTestDevice, type TestDevice, type TestDeviceOrigin } from '../../application/test-device'
import type { CatalogDetail } from '../../device-catalog/catalog-api'

const props = withDefaults(defineProps<{
  readonly open: boolean
  readonly catalogs: ReadonlyArray<CatalogDetail>
  readonly initialCatalogKey?: string
  readonly initialBaudRate?: number
  readonly initialSlaveId?: number
  readonly initialDevice?: TestDevice | null
  readonly origin?: TestDeviceOrigin
  readonly catalogLocked?: boolean
  readonly connectionActive?: boolean
  readonly prepareConnection?: () => Promise<void>
}>(), { initialDevice: null, origin: 'catalog', catalogLocked: false, connectionActive: false })
const emit = defineEmits<{ cancel: []; save: [device: TestDevice] }>()

const dialog = ref<HTMLDialogElement | null>(null)
const nameInput = ref<HTMLInputElement | null>(null)
const catalogKey = ref('')
const name = ref('')
const baudRate = ref<number | null>(null)
const slaveId = ref<number | null>(null)
const errorMessage = ref<string | null>(null)
const submitting = ref(false)
const initialSignature = ref('')
const selectedCatalog = computed(() => props.catalogs.find((catalog) => catalog.catalogKey === catalogKey.value) ?? null)
const isEditing = computed(() => props.initialDevice !== null)
const isDirty = computed(() => signature() !== initialSignature.value)
const compatibility = computed(() => selectedCatalog.value
  ? checkTestDeviceCatalogCompatibility(selectedCatalog.value, baudRate.value, slaveId.value)
  : null)
const unsupportedObservedBaudRate = computed(() => props.origin === 'scan'
  && baudRate.value !== null
  && compatibility.value?.baudRateSupported === false)
const compatibilityWarning = computed(() => {
  if (props.origin !== 'scan' || !selectedCatalog.value || !compatibility.value) return null
  const fields = [
    compatibility.value.baudRateSupported ? null : 'Baudrate',
    compatibility.value.slaveIdSupported ? null : 'Slave ID',
  ].filter((field): field is string => field !== null)
  return fields.length
    ? `스캔에서 찾은 ${fields.join('와 ')}가 선택한 Catalog의 허용 범위와 다릅니다. Catalog를 바꾸거나 통신값을 수정해 주세요.`
    : null
})

function signature(): string { return JSON.stringify([catalogKey.value, name.value, baudRate.value, slaveId.value]) }

/** 호출 화면의 Catalog 또는 기존 Test Device를 폼 기본값으로 변환한다. */
function resetForm(): void {
  const initial = props.initialDevice
  catalogKey.value = initial?.catalogKey ?? props.initialCatalogKey ?? props.catalogs[0]?.catalogKey ?? ''
  const catalog = props.catalogs.find((item) => item.catalogKey === catalogKey.value) ?? null
  name.value = initial?.name ?? catalog?.title ?? ''
  baudRate.value = initial?.serialConfig.baudRate ?? props.initialBaudRate ?? catalog?.definition.profile.serial.default.baudRate ?? null
  slaveId.value = initial?.slaveId ?? props.initialSlaveId ?? catalog?.definition.profile.slave.defaultId ?? null
  errorMessage.value = null
  initialSignature.value = signature()
}

watch(() => props.open, async (open) => {
  if (!open) { if (dialog.value?.open) dialog.value.close(); return }
  resetForm()
  await nextTick()
  if (!dialog.value?.open) dialog.value?.showModal()
  nameInput.value?.focus()
}, { immediate: true })

watch(catalogKey, (nextKey, previousKey) => {
  if (!previousKey || nextKey === previousKey || props.initialDevice) return
  const catalog = selectedCatalog.value
  if (!catalog) return
  name.value = catalog.title
  const profile = catalog.definition.profile
  if (!profile.serial.supportedBaudRates.includes(Number(baudRate.value))) baudRate.value = profile.serial.default.baudRate
  if (!Number.isInteger(slaveId.value) || Number(slaveId.value) < profile.slave.minId || Number(slaveId.value) > profile.slave.maxId) slaveId.value = profile.slave.defaultId
})

function requestClose(): void {
  if (isDirty.value && !window.confirm('입력한 변경 내용을 버릴까요?')) return
  emit('cancel')
}

function handleCancel(event: Event): void { event.preventDefault(); requestClose() }
function handleBackdrop(event: MouseEvent): void { if (event.target === dialog.value) requestClose() }

/** 제출 시 domain validator를 거친 불변 TestDevice만 상위 화면에 전달한다. */
async function submit(): Promise<void> {
  const catalog = selectedCatalog.value
  if (!catalog || baudRate.value === null || slaveId.value === null) { errorMessage.value = 'Catalog와 통신 설정을 확인해 주세요.'; return }
  try {
    const device = createTestDevice(catalog, {
      name: name.value, baudRate: Number(baudRate.value), slaveId: Number(slaveId.value),
      origin: props.initialDevice?.origin ?? props.origin,
    })
    submitting.value = true
    if (!isEditing.value && props.prepareConnection) await props.prepareConnection()
    emit('save', device)
  } catch (error) { errorMessage.value = error instanceof Error ? error.message : '입력값을 확인해 주세요.' }
  finally { submitting.value = false }
}
</script>

<template>
  <dialog ref="dialog" class="test-device-dialog" aria-labelledby="test-device-dialog-title" @cancel="handleCancel" @click="handleBackdrop">
    <form class="test-device-modal" method="dialog" @submit.prevent="submit">
      <header>
        <div><p class="eyebrow">DEVICE CONNECTION</p><h2 id="test-device-dialog-title">{{ isEditing ? '카탈로그 수정' : '장비 연결하기' }}</h2><p>Catalog의 허용 범위에서 연결에 사용할 통신값을 정합니다.</p></div>
        <button class="dialog-close" type="button" aria-label="닫기" @click="requestClose">×</button>
      </header>
      <p v-if="errorMessage" class="notice error">{{ errorMessage }}</p>
      <p v-if="compatibilityWarning" class="notice warning" role="alert">{{ compatibilityWarning }}</p>
      <div class="test-device-fields">
        <label>장비 이름<input ref="nameInput" v-model="name" maxlength="100" autocomplete="off"></label>
        <label>Catalog<select v-model="catalogKey" :disabled="catalogLocked || connectionActive"><option v-for="catalog in catalogs" :key="catalog.catalogKey" :value="catalog.catalogKey">{{ catalog.title }} · {{ catalog.manufacturer }} {{ catalog.model }}</option></select></label>
        <label>Baudrate<select v-model.number="baudRate" :disabled="connectionActive"><option v-if="unsupportedObservedBaudRate && baudRate !== null" disabled :value="baudRate">{{ baudRate.toLocaleString() }} (Catalog 미지원)</option><option v-for="rate in selectedCatalog?.definition.profile.serial.supportedBaudRates ?? []" :key="rate" :value="rate">{{ rate.toLocaleString() }}</option></select></label>
        <label>Slave ID<input v-model.number="slaveId" type="number" inputmode="numeric" :min="selectedCatalog?.definition.profile.slave.minId" :max="selectedCatalog?.definition.profile.slave.maxId" :disabled="connectionActive"></label>
      </div>
      <p v-if="connectionActive" class="notice warning">연결 중에는 이름만 수정할 수 있습니다. 통신값은 연결을 해제한 뒤 변경해 주세요.</p>
      <footer><button class="button button-ghost" type="button" :disabled="submitting" @click="requestClose">취소</button><button class="button button-primary" type="submit" :disabled="submitting">{{ submitting ? '포트 선택 중…' : (isEditing ? '변경 적용' : '연결하기') }}</button></footer>
    </form>
  </dialog>
</template>
