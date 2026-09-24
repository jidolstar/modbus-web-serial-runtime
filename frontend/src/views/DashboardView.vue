<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { AuthUser } from '../auth/auth-api'
import { parseAppRoute, routeUrl, type AppRoute } from '../device-catalog/catalog-route'
import AppShell from '../layout/AppShell.vue'
import CatalogDetailView from './CatalogDetailView.vue'
import CatalogEditorView from './CatalogEditorView.vue'
import CatalogManagementView from './CatalogManagementView.vue'
import DeviceScanView from './DeviceScanView.vue'
import TestDeviceView from './TestDeviceView.vue'
import { testBusSession } from '../application/test-bus-session'

defineProps<{ readonly user: AuthUser; readonly isLoggingOut: boolean }>()
defineEmits<{ logout: [] }>()
const route = ref<AppRoute>(parseAppRoute())
const activeSection = computed<'dashboard' | 'catalogs' | 'scan'>(() => {
  if (route.value.page === 'dashboard') return 'dashboard'
  return route.value.page === 'scan' ? 'scan' : 'catalogs'
})
const catalogEditRoute = computed(() => {
  const currentRoute = route.value
  if (currentRoute.page === 'catalog-edit-json') return { mode: 'json' as const, catalogKey: currentRoute.catalogKey }
  if (currentRoute.page === 'catalog-edit-thumbnail') return { mode: 'thumbnail' as const, catalogKey: currentRoute.catalogKey }
  if (currentRoute.page === 'catalog-edit-files') return { mode: 'files' as const, catalogKey: currentRoute.catalogKey }
  if (currentRoute.page === 'catalog-edit-links') return { mode: 'links' as const, catalogKey: currentRoute.catalogKey }
  return null
})

/** Sidebar와 Catalog 하위 화면에서 호출해 History와 렌더링 route를 동시에 변경한다. */
function navigate(nextRoute: AppRoute): void {
  const nextUrl = routeUrl(nextRoute)
  if (`${window.location.pathname}${window.location.search}` !== nextUrl) window.history.pushState(null, '', nextUrl)
  route.value = nextRoute
  window.scrollTo({ top: 0, behavior: 'auto' })
}
function handleShellNavigation(section: 'dashboard' | 'catalogs' | 'scan'): void {
  if (section === 'dashboard') navigate({ page: 'dashboard' })
  else navigate(section === 'scan' ? { page: 'scan' } : { page: 'catalog-list' })
}
function handlePopState(): void { route.value = parseAppRoute() }
window.addEventListener('popstate', handlePopState)
onBeforeUnmount(() => { window.removeEventListener('popstate', handlePopState); void testBusSession.close() })
</script>
<template>
  <AppShell :user="user" :is-logging-out="isLoggingOut" :active-section="activeSection" @navigate="handleShellNavigation" @logout="$emit('logout')">
    <template v-if="route.page === 'dashboard'">
      <header class="page-heading">
      <div><p class="eyebrow">DEVICE OPERATIONS</p><h1>장비 대시보드</h1><p class="description">연결 상태와 실시간 측정값을 한곳에서 확인합니다.</p></div>
      <span class="page-date">브라우저 로컬 실행</span>
      </header>
      <section class="summary-grid" aria-label="시스템 요약">
      <article class="summary-card"><span class="summary-icon blue" aria-hidden="true">▦</span><div><span>장비 카탈로그</span><strong>DB 연동</strong><small>활성 Catalog를 실행에 사용합니다.</small></div></article>
      <article class="summary-card"><span class="summary-icon green" aria-hidden="true">⌁</span><div><span>통신 실행 위치</span><strong>이 브라우저</strong><small>장비 데이터는 로컬에서 처리됩니다.</small></div></article>
      <article class="summary-card"><span class="summary-icon amber" aria-hidden="true">◉</span><div><span>테스트 방식</span><strong>Catalog 기반</strong><small>장비별 측정 Recipe를 실행합니다.</small></div></article>
      </section>
      <section class="surface-card dashboard-start"><div><p class="eyebrow">GET STARTED</p><h2>테스트 장비를 만들어 시작하세요</h2><p class="description">장비 모델을 알고 있다면 Catalog에서 만들고, 통신값을 모르면 먼저 Scan을 실행합니다.</p></div><div class="inline-actions"><button class="button button-primary" type="button" @click="navigate({ page: 'catalog-list' })">Catalog 선택</button><button class="button button-ghost" type="button" @click="navigate({ page: 'scan' })">장비 Scan</button></div></section>
    </template>
    <CatalogManagementView v-else-if="route.page === 'catalog-list'" :search="route.search" @navigate="navigate" />
    <CatalogDetailView v-else-if="route.page === 'catalog-view'" :catalog-key="route.catalogKey" @navigate="navigate" />
    <CatalogEditorView v-else-if="catalogEditRoute" :mode="catalogEditRoute.mode" :catalog-key="catalogEditRoute.catalogKey" @navigate="navigate" />
    <DeviceScanView v-else-if="route.page === 'scan'" @navigate="navigate" />
    <TestDeviceView v-else-if="route.page === 'test-device'" :route="route" @navigate="navigate" />
    <CatalogEditorView v-else-if="route.page === 'catalog-add'" mode="add" :observed-baud-rate="route.observedBaudRate" :observed-slave-id="route.observedSlaveId" @navigate="navigate" />
  </AppShell>
</template>
