<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { catalogApi, CatalogApiError, type CatalogSummary } from '../device-catalog/catalog-api'
import type { AppRoute } from '../device-catalog/catalog-route'
import CatalogCard from '../features/catalogs/CatalogCard.vue'

const emit = defineEmits<{ navigate: [route: AppRoute] }>()
const props = withDefaults(defineProps<{ readonly search?: string }>(), { search: '' })
const catalogs = ref<CatalogSummary[]>([])
const total = ref(0)
const query = ref(props.search)
const loading = ref(false)
const listFailed = ref(false)
const notice = ref<string | null>(null)
const canReset = computed(() => Boolean(query.value.trim() || props.search))

function publicError(error: unknown): string {
  if (error instanceof CatalogApiError && error.status === 401) return '로그인 세션이 만료되었습니다. 페이지를 새로고침해 주세요.'
  return '카탈로그 목록을 불러오지 못했습니다.'
}

/** 목록 route 진입과 검색 submit에서 요약 정보만 조회하며, 일시 장애는 한 번 자동 재시도한다. */
async function loadCatalogs(retryTransient = true): Promise<void> {
  loading.value = true; notice.value = null
  try {
    const result = await catalogApi.list(query.value)
    catalogs.value = result.items; total.value = result.total; listFailed.value = false
  } catch (error) {
    const transient = !(error instanceof CatalogApiError) || error.status === 0 || error.status >= 500
    if (retryTransient && transient) {
      await new Promise((resolve) => setTimeout(resolve, 700)); loading.value = false; await loadCatalogs(false); return
    }
    listFailed.value = true; notice.value = publicError(error)
  } finally { loading.value = false }
}

/** 검색 submit에서 정규화한 검색어를 URL route에 기록하면 watcher가 목록을 다시 조회한다. */
function submitSearch(): void {
  const search = query.value.trim()
  emit('navigate', search ? { page: 'catalog-list', search } : { page: 'catalog-list' })
  if (search === props.search) void loadCatalogs()
}
function resetSearch(): void {
  if (!canReset.value) return
  query.value = ''
  emit('navigate', { page: 'catalog-list' })
}

onMounted(loadCatalogs)
watch(() => props.search, (search) => { query.value = search; void loadCatalogs() })
</script>

<template>
  <header class="page-heading">
    <div><p class="eyebrow">DEVICE CATALOG</p><h1>장비 카탈로그</h1><p class="description">Profile과 Recipe JSON, 제품 자료를 DB에서 관리합니다.</p></div>
    <button class="button button-primary button-small" type="button" @click="emit('navigate', { page: 'catalog-add' })">새 카탈로그</button>
  </header>
  <div v-if="notice" class="notice error"><span>{{ notice }}</span><button v-if="listFailed" class="button button-ghost button-small" type="button" @click="loadCatalogs()">다시 시도</button></div>
  <section class="catalog-toolbar surface-card">
    <form class="catalog-search" @submit.prevent="submitSearch"><label class="sr-only" for="catalog-search">카탈로그 검색</label><input id="catalog-search" v-model="query" maxlength="100" placeholder="제목, key, 제조사 또는 모델 검색"><button class="button button-secondary button-small" type="submit" :disabled="loading">검색</button><button class="button button-ghost button-small" type="button" :disabled="loading || !canReset" @click="resetSearch">초기화</button></form>
    <span>총 {{ total }}개</span>
  </section>
  <section v-if="catalogs.length" class="catalog-grid" aria-label="카탈로그 목록">
    <CatalogCard v-for="catalog in catalogs" :key="catalog.catalogKey" :catalog="catalog" @view="emit('navigate', { page: 'catalog-view', catalogKey: catalog.catalogKey })" />
  </section>
  <p v-else-if="!loading && !listFailed" class="empty-panel surface-card">검색 조건에 맞는 카탈로그가 없습니다.</p>
  <p v-else-if="listFailed" class="empty-panel surface-card">목록을 불러오지 못했습니다. 다시 시도해 주세요.</p>
</template>
