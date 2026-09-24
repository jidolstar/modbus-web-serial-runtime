<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import exampleBundle from '@modbus-manager/device-catalog-domain/examples/cwt-th04s.bundle.json'
import { catalogApi, CatalogApiError, type CatalogDetail } from '../device-catalog/catalog-api'
import type { AppRoute } from '../device-catalog/catalog-route'
import { DeviceProfileValidator } from '../device-catalog/device-profile-validator'
import CatalogAssetsPanel from '../features/catalogs/CatalogAssetsPanel.vue'
import CatalogThumbnailInput from '../features/catalogs/CatalogThumbnailInput.vue'
import HelpTooltip from '../components/HelpTooltip.vue'
import { HELP_TOOLTIP_COPY } from '../components/help-tooltip-copy'

type EditorMode = 'add' | 'json' | 'thumbnail' | 'files' | 'links'

const props = defineProps<{ readonly mode: EditorMode; readonly catalogKey?: string; readonly observedBaudRate?: number; readonly observedSlaveId?: number }>()
const emit = defineEmits<{ navigate: [route: AppRoute] }>()
const validator = new DeviceProfileValidator()
const detail = ref<CatalogDetail | null>(null)
const title = ref('')
function initialDefinition(): string {
  if (props.mode !== 'add') return ''
  const definition = JSON.parse(JSON.stringify(exampleBundle)) as typeof exampleBundle
  if (props.observedBaudRate && props.observedSlaveId) {
    definition.profile.serial.default.baudRate = props.observedBaudRate
    definition.profile.serial.supportedBaudRates = [...new Set([...definition.profile.serial.supportedBaudRates, props.observedBaudRate])].sort((left, right) => left - right)
    definition.profile.slave.defaultId = props.observedSlaveId
  }
  return JSON.stringify(definition, null, 2)
}
const definitionText = ref(initialDefinition())
const validationMessages = ref<string[]>([])
const notice = ref<string | null>(null)
const busy = ref(false)
const pageTitleByMode: Record<EditorMode, string> = {
  add: '새 카탈로그 등록',
  json: 'JSON 및 기본 정보 수정',
  thumbnail: '썸네일 등록 및 수정',
  files: '참고파일 수정',
  links: '참고링크 수정',
}
const pageDescriptionByMode: Record<EditorMode, string> = {
  add: 'Profile 하나와 참조하는 Recipe 전체를 JSON으로 입력합니다.',
  json: '제목, CatalogBundle JSON과 운영 상태를 관리합니다.',
  thumbnail: '제품을 식별할 대표 이미지를 등록하거나 교체합니다.',
  files: '통신 문서, 매뉴얼과 참고 이미지를 관리합니다.',
  links: '공식 홈페이지와 외부 참고 자료 주소를 관리합니다.',
}
const pageTitle = computed(() => pageTitleByMode[props.mode])
const noticeIsSuccess = computed(() => notice.value?.includes('통과') || notice.value?.includes('완료'))

function apiMessage(error: unknown): string {
  if (error instanceof CatalogApiError && error.code === 'CATALOG_REVISION_CONFLICT') return '다른 곳에서 먼저 수정했습니다. 상세 화면에서 최신 내용을 다시 확인해 주세요.'
  if (error instanceof CatalogApiError && error.fields.length) return `입력값을 확인해 주세요: ${error.fields.join(', ')}`
  return '카탈로그 요청을 처리하지 못했습니다.'
}

function cancelRoute(): AppRoute {
  return props.mode !== 'add' && props.catalogKey ? { page: 'catalog-view', catalogKey: props.catalogKey } : { page: 'catalog-list' }
}

/** 수정 route 진입 시 현재 revision과 JSON을 불러와 낙관적 잠금 저장에 사용한다. */
async function loadForEdit(): Promise<void> {
  if (props.mode === 'add' || !props.catalogKey) return
  busy.value = true
  try {
    detail.value = await catalogApi.get(props.catalogKey)
    if (props.mode === 'json') {
      title.value = detail.value.title
      definitionText.value = JSON.stringify(detail.value.definition, null, 2)
    }
  }
  catch (error) { notice.value = apiMessage(error) }
  finally { busy.value = false }
}

function parseAndValidate(): unknown | null {
  validationMessages.value = []
  if (!title.value.trim()) { validationMessages.value = ['title: 카탈로그 제목을 입력해 주세요.']; return null }
  let candidate: unknown
  try { candidate = JSON.parse(definitionText.value) } catch { validationMessages.value = ['definition: 올바른 JSON 형식이 아닙니다.']; return null }
  try { validator.validateCatalogBundle(candidate, 'definition'); return candidate }
  catch (error) { validationMessages.value = [error instanceof Error ? error.message : 'CatalogBundle 검증에 실패했습니다.']; return null }
}

async function validateOnly(): Promise<void> {
  const candidate = parseAndValidate(); if (!candidate) return
  try { await catalogApi.validate(title.value.trim(), candidate); notice.value = '서버 검증을 통과했습니다.' }
  catch (error) { validationMessages.value = [apiMessage(error)] }
}

/** 등록·수정 submit에서 검증된 전체 Bundle을 저장하고 별도 상세 URL로 이동한다. */
async function save(): Promise<void> {
  const candidate = parseAndValidate(); if (!candidate || busy.value) return
  busy.value = true
  try {
    const saved = props.mode === 'json' && detail.value
      ? await catalogApi.update(detail.value.catalogKey, title.value.trim(), candidate, detail.value.revision)
      : await catalogApi.create(title.value.trim(), candidate)
    emit('navigate', { page: 'catalog-view', catalogKey: saved.catalogKey })
  } catch (error) { validationMessages.value = [apiMessage(error)] }
  finally { busy.value = false }
}

/** 수정 페이지에서만 실행 가능 상태를 변경해 조회 화면이 쓰기 책임을 갖지 않도록 한다. */
async function toggleStatus(): Promise<void> {
  if (!detail.value || busy.value) return
  busy.value = true
  try { const updated = await catalogApi.updateStatus(detail.value.catalogKey, !detail.value.enabled, detail.value.revision); detail.value = { ...detail.value, ...updated } }
  catch { notice.value = '활성 상태를 변경하지 못했습니다.' }
  finally { busy.value = false }
}

/** 썸네일 자식 화면이 저장을 마치면 이전 실패 안내를 성공 상태로 교체한다. */
function handleThumbnailChanged(): void {
  notice.value = '썸네일 등록·교체가 완료되었습니다.'
}

onMounted(loadForEdit)
</script>

<template>
  <header class="page-heading detail-page-heading"><div><button class="text-link" type="button" @click="emit('navigate', cancelRoute())">← 돌아가기</button><p class="eyebrow">{{ mode === 'add' ? 'NEW CATALOG' : 'EDIT CATALOG' }}</p><h1>{{ pageTitle }}</h1><p class="description">{{ pageDescriptionByMode[mode] }}</p></div></header>
  <p v-if="notice" class="notice" :class="noticeIsSuccess ? 'success' : 'error'">{{ notice }}</p>
  <section v-if="mode === 'add' || mode === 'json'" class="catalog-editor surface-card">
    <div class="editor-fields"><div class="form-field"><span class="field-label"><label for="catalog-title">카탈로그 제목</label><HelpTooltip label="카탈로그 제목" :text="HELP_TOOLTIP_COPY.catalogTitle" /></span><input id="catalog-title" v-model="title" maxlength="160" placeholder="Example TEMP-100 온도 센서"></div><div class="form-field"><span class="field-label"><label for="catalog-definition">CatalogBundle JSON</label><HelpTooltip label="CatalogBundle JSON" :text="HELP_TOOLTIP_COPY.catalogBundle" /></span><textarea id="catalog-definition" v-model="definitionText" rows="28" spellcheck="false" aria-describedby="json-help"></textarea><small id="json-help">입력 JSON은 Schema로 검증하며 코드로 실행하지 않습니다.</small></div></div>
    <div v-if="validationMessages.length" class="notice error" role="alert"><strong>검증 결과</strong><ul><li v-for="message in validationMessages" :key="message">{{ message }}</li></ul></div>
    <div class="editor-actions"><button v-if="mode === 'add'" class="button button-ghost button-small" type="button" @click="definitionText = JSON.stringify(exampleBundle, null, 2)">예시 불러오기</button><button class="button button-ghost button-small" type="button" @click="emit('navigate', cancelRoute())">취소</button><button class="button button-secondary button-small" type="button" :disabled="busy" @click="validateOnly">검증</button><button class="button button-primary button-small" type="button" :disabled="busy" @click="save">{{ busy ? '처리 중…' : (mode === 'add' ? '등록' : '저장') }}</button></div>
  </section>
  <section v-if="mode === 'json' && detail" class="edit-management surface-card"><div><h2 class="help-label">운영 상태 <HelpTooltip label="운영 상태" :text="HELP_TOOLTIP_COPY.operationalStatus" /></h2><p>비활성 카탈로그는 새 Runtime snapshot에서 제외됩니다.</p></div><div class="inline-actions"><span class="status-pill" :class="detail.enabled ? 'success' : 'muted'">{{ detail.enabled ? '활성' : '비활성' }}</span><button class="button button-ghost button-small" type="button" :disabled="busy" @click="toggleStatus">{{ detail.enabled ? '비활성화' : '활성화' }}</button></div></section>
  <CatalogThumbnailInput v-if="mode === 'thumbnail' && detail" :catalog-key="detail.catalogKey" @changed="handleThumbnailChanged" @error="notice = $event" />
  <CatalogAssetsPanel v-if="(mode === 'files' || mode === 'links') && detail" :catalog-key="detail.catalogKey" :mode="mode" @error="notice = $event" />
</template>
