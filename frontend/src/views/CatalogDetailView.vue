<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { capabilityAdapterRegistry } from '../device-catalog/adapter-registry'
import { catalogApi, CatalogApiError, type CatalogDetail, type CatalogFileItem, type CatalogLinkItem } from '../device-catalog/catalog-api'
import type { AppRoute } from '../device-catalog/catalog-route'

const props = defineProps<{ readonly catalogKey: string }>()
const emit = defineEmits<{ navigate: [route: AppRoute] }>()
const detail = ref<CatalogDetail | null>(null)
const loading = ref(true)
const notice = ref<string | null>(null)
const files = ref<CatalogFileItem[]>([])
const links = ref<CatalogLinkItem[]>([])
const thumbnailUrl = ref<string | null>(null)
const extensions = computed(() => detail.value?.definition.profile.extensions ?? [])

function publicError(error: unknown): string {
  if (error instanceof CatalogApiError && error.status === 404) return '카탈로그를 찾을 수 없습니다.'
  if (error instanceof CatalogApiError && error.status === 401) return '로그인 세션이 만료되었습니다.'
  return '카탈로그 상세 정보를 불러오지 못했습니다.'
}

/** 상세 route 진입 시 URL에서 검증된 key로 전체 CatalogBundle을 불러온다. */
async function load(): Promise<void> {
  loading.value = true; notice.value = null
  try {
    const [catalog, fileItems, linkItems, thumbnail] = await Promise.all([
      catalogApi.get(props.catalogKey), catalogApi.listFiles(props.catalogKey), catalogApi.listLinks(props.catalogKey), catalogApi.getThumbnailBlob(props.catalogKey),
    ])
    detail.value = catalog; files.value = fileItems; links.value = linkItems
    if (thumbnail) thumbnailUrl.value = URL.createObjectURL(thumbnail)
  }
  catch (error) { notice.value = publicError(error) }
  finally { loading.value = false }
}

async function download(file: CatalogFileItem): Promise<void> {
  try { const blob = await catalogApi.downloadFile(props.catalogKey, file); const url = URL.createObjectURL(blob); const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.originalName; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 0) }
  catch { notice.value = 'clean 상태의 파일만 다운로드할 수 있습니다.' }
}
function safeUrl(value: string): string | undefined { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined } catch { return undefined } }

onMounted(load)
onBeforeUnmount(() => { if (thumbnailUrl.value) URL.revokeObjectURL(thumbnailUrl.value) })
</script>

<template>
  <header class="page-heading detail-page-heading">
    <div><button class="text-link" type="button" @click="emit('navigate', { page: 'catalog-list' })">← 목록으로</button><p class="eyebrow">CATALOG DETAIL</p><h1>{{ detail?.title ?? '카탈로그 상세' }}</h1><p v-if="detail" class="description">{{ detail.manufacturer }} · {{ detail.model }}</p></div>
  </header>
  <p v-if="notice" class="notice error">{{ notice }}</p>
  <p v-if="loading" class="empty-panel surface-card">불러오는 중입니다.</p>
  <template v-else-if="detail">
    <section class="catalog-overview surface-card">
      <div><span>상태</span><strong><i class="status-dot" :class="{ active: detail.enabled }" />{{ detail.enabled ? '활성' : '비활성' }}</strong></div>
      <div><span>Catalog key</span><strong>{{ detail.catalogKey }}</strong></div>
      <div><span>Revision</span><strong>{{ detail.revision }}</strong></div>
      <div><span>Schema</span><strong>{{ detail.schemaVersion }}</strong></div>
    </section>
    <section class="catalog-detail-layout">
      <div class="catalog-main-column">
        <section class="surface-card detail-section"><div class="section-heading"><div><h2>CatalogBundle JSON</h2><p>서버에서 검증되어 저장된 실행 정의입니다.</p></div><button class="button button-ghost button-small" type="button" @click="emit('navigate', { page: 'catalog-edit-json', catalogKey: detail.catalogKey })">수정</button></div><pre class="json-viewer">{{ JSON.stringify(detail.definition, null, 2) }}</pre></section>
        <section v-if="extensions.length" class="surface-card detail-section"><div class="section-heading"><div><h2>Capability adapter</h2><p>사전 배포된 TypeScript adapter 지원 상태입니다.</p></div></div><ul class="adapter-list"><li v-for="extension in extensions" :key="`${extension.capability}:${extension.adapterId}`"><code>{{ extension.capability }}</code><span>{{ extension.adapterId }}</span><span class="status-pill" :class="capabilityAdapterRegistry.supports(extension) ? 'success' : 'warning'">{{ capabilityAdapterRegistry.supports(extension) ? '지원됨' : '현재 배포본 미지원' }}</span></li></ul></section>
      </div>
      <aside class="catalog-side-column"><section class="surface-card detail-section"><div class="section-heading"><div><h2>제품 썸네일</h2></div><button class="button button-ghost button-small" type="button" @click="emit('navigate', { page: 'catalog-edit-thumbnail', catalogKey: detail.catalogKey })">수정</button></div><div class="readonly-thumbnail" :class="{ placeholder: !thumbnailUrl }"><img v-if="thumbnailUrl" :src="thumbnailUrl" :alt="`${detail.title} 썸네일`"><span v-else>이미지 없음</span></div></section></aside>
    </section>
    <section class="surface-card detail-section detail-asset-section"><div class="section-heading"><div><h2>참고 파일</h2><p>등록된 문서를 조회하고 clean 상태의 파일을 다운로드합니다.</p></div><button class="button button-ghost button-small" type="button" @click="emit('navigate', { page: 'catalog-edit-files', catalogKey: detail.catalogKey })">수정</button></div><ul v-if="files.length" class="asset-list readonly"><li v-for="file in files" :key="file.id"><div><strong>{{ file.title }}</strong><span>{{ file.originalName }} · {{ file.documentType }}</span></div><span class="status-pill" :class="file.status === 'clean' ? 'success' : 'warning'">{{ file.status }}</span><button class="button button-ghost button-small" type="button" :disabled="file.status !== 'clean'" @click="download(file)">다운로드</button></li></ul><p v-else class="empty-copy">등록된 참고 파일이 없습니다.</p></section>
    <section class="surface-card detail-section detail-asset-section"><div class="section-heading"><div><h2>참고 링크</h2></div><button class="button button-ghost button-small" type="button" @click="emit('navigate', { page: 'catalog-edit-links', catalogKey: detail.catalogKey })">수정</button></div><ul v-if="links.length" class="asset-list readonly"><li v-for="link in links" :key="link.id"><div><strong>{{ link.title }}</strong><a v-if="safeUrl(link.url)" :href="safeUrl(link.url)" target="_blank" rel="noopener noreferrer">{{ link.url }}</a><span v-else>유효하지 않은 URL</span></div><span class="status-pill muted">{{ link.linkType }}</span></li></ul><p v-else class="empty-copy">등록된 참고 링크가 없습니다.</p></section>
  </template>
</template>
