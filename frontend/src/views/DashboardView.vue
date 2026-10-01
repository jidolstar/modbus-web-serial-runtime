<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import type { AuthUser } from '../auth/auth-api'
import ScanIcon from '../components/ScanIcon.vue'
import {
  initialAppHistoryState,
  nextAppHistoryState,
  parseAppHistoryState,
  parseAppRoute,
  routePresentation,
  routeUrl,
  type AppRoute,
} from '../device-catalog/catalog-route'
import AppShell from '../layout/AppShell.vue'
import CatalogDetailView from './CatalogDetailView.vue'
import CatalogEditorView from './CatalogEditorView.vue'
import CatalogManagementView from './CatalogManagementView.vue'
import CatalogAiCreateView from './CatalogAiCreateView.vue'
import DeviceScanView from './DeviceScanView.vue'
import TestDeviceView from './TestDeviceView.vue'
import TestGroupListView from './TestGroupListView.vue'
import TestGroupEditorView from './TestGroupEditorView.vue'
import TestGroupRunView from './TestGroupRunView.vue'
import { testBusSession } from '../application/test-bus-session'

defineProps<{ readonly user: AuthUser; readonly isLoggingOut: boolean }>()
defineEmits<{ logout: [] }>()
const route = ref<AppRoute>(parseAppRoute())
const catalogAiView = ref<{ requestLeave: () => void } | null>(null)
const presentation = computed(() => routePresentation(route.value))

// 새 탭·직접 URL 진입은 depth 0으로 표시해 상단 back이 외부 사이트로 이탈하지 않게 한다.
window.history.replaceState(initialAppHistoryState(window.history.state), '', window.location.href)
const activeSection = computed<'dashboard' | 'catalogs' | 'scan' | 'test-groups'>(() => {
  if (route.value.page === 'dashboard') return 'dashboard'
  if (route.value.page.startsWith('test-group')) return 'test-groups'
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

/**
 * Sidebar와 하위 화면에서 호출해 기존 Serial 연결을 닫은 뒤 History와 화면을 변경한다.
 * close를 기다려 다음 화면이 같은 물리 port를 여는 시점과 이전 stream 정리가 겹치지 않게 한다.
 */
async function navigate(nextRoute: AppRoute, replace = false): Promise<void> {
  const nextUrl = routeUrl(nextRoute)
  if (`${window.location.pathname}${window.location.search}` === nextUrl) return
  await testBusSession.close()
  if (replace) {
    window.history.replaceState(initialAppHistoryState(window.history.state), '', nextUrl)
  } else {
    window.history.pushState(nextAppHistoryState(window.history.state), '', nextUrl)
  }
  route.value = nextRoute
  window.scrollTo({ top: 0, behavior: 'auto' })
}

/**
 * AppShell의 back 버튼에서 호출한다. 앱이 만든 이전 entry만 history.back으로 열고,
 * 직접 진입한 상세 화면은 route별 상위 화면으로 교체해 외부 페이지 이탈을 막는다.
 */
async function goBackOrFallback(): Promise<void> {
  const historyState = parseAppHistoryState(window.history.state)
  await testBusSession.close()
  if (historyState && historyState.depth > 0) {
    window.history.back()
    return
  }
  const fallbackRoute = presentation.value.fallbackRoute
  if (fallbackRoute) await navigate(fallbackRoute, true)
}

/** AI 작성 화면은 server session과 proposal 폐기 확인을 마친 뒤 실제 back 요청을 다시 보낸다. */
function handleBackRequest(): void {
  if ((route.value.page === 'catalog-ai-add' || route.value.page === 'catalog-ai-edit') && catalogAiView.value) {
    catalogAiView.value.requestLeave()
    return
  }
  void goBackOrFallback()
}
function handleShellNavigation(section: 'dashboard' | 'catalogs' | 'scan' | 'test-groups'): void {
  if (section === 'dashboard') navigate({ page: 'dashboard' })
  else if (section === 'test-groups') navigate({ page: 'test-group-list' })
  else navigate(section === 'scan' ? { page: 'scan' } : { page: 'catalog-list' })
}
/** 브라우저 뒤로가기에서도 이전 화면의 port 정리가 끝난 다음 대상 화면을 렌더링한다. */
async function handlePopState(): Promise<void> {
  await testBusSession.close()
  route.value = parseAppRoute()
  window.scrollTo({ top: 0, behavior: 'auto' })
}
window.addEventListener('popstate', handlePopState)
onBeforeUnmount(() => { window.removeEventListener('popstate', handlePopState); void testBusSession.close() })
</script>
<template>
  <AppShell
    :user="user"
    :is-logging-out="isLoggingOut"
    :active-section="activeSection"
    :page-title="presentation.title"
    :page-context="presentation.context"
    :show-back="presentation.showBack"
    @back="handleBackRequest"
    @navigate="handleShellNavigation"
    @logout="$emit('logout')"
  >
    <template v-if="route.page === 'dashboard'">
      <header class="page-heading">
      <div><p class="eyebrow">MODBUS DEVICE TOOL</p><h1>RS485 Modbus RTU 장비를 브라우저에서 관리하세요</h1><p class="description">브라우저에서 USB Serial을 통해 RS485 Modbus RTU 장비를 탐색하고, 테스트하고, 설정하는 도구입니다.</p></div>
      <span class="page-date">브라우저 로컬 실행</span>
      </header>
      <section class="summary-grid" aria-label="주요 기능">
      <article class="summary-card"><span class="summary-icon blue" aria-hidden="true"><ScanIcon /></span><div><span>장비 탐색</span><strong>Modbus Scan</strong><small>USB Serial에 연결된 RS485 장비를 찾습니다.</small></div></article>
      <article class="summary-card"><span class="summary-icon green" aria-hidden="true">◉</span><div><span>장비 테스트</span><strong>Catalog 기반 실행</strong><small>장비별 Recipe로 측정과 동작을 확인합니다.</small></div></article>
      <article class="summary-card"><span class="summary-icon amber" aria-hidden="true">⚙</span><div><span>장비 설정</span><strong>브라우저에서 직접</strong><small>지원되는 장비 설정을 로컬 통신으로 변경합니다.</small></div></article>
      </section>
      <section class="surface-card dashboard-start"><div><p class="eyebrow">GET STARTED</p><h2>연결할 장비에 맞는 방법으로 시작하세요</h2><p class="description">장비 모델과 통신 설정을 알고 있다면 Catalog를 선택하고, 알 수 없다면 먼저 장비 Scan을 실행합니다.</p></div><div class="inline-actions"><button class="button button-primary" type="button" @click="navigate({ page: 'catalog-list' })">장비 Catalog 보기</button><button class="button button-ghost" type="button" @click="navigate({ page: 'scan' })">장비 Scan 시작</button></div></section>
    </template>
    <CatalogManagementView v-else-if="route.page === 'catalog-list'" :search="route.search" :page="route.listPage" @navigate="navigate" />
    <CatalogAiCreateView v-else-if="route.page === 'catalog-ai-add'" ref="catalogAiView" mode="create" @back="goBackOrFallback" @navigate="navigate" />
    <CatalogAiCreateView v-else-if="route.page === 'catalog-ai-edit'" ref="catalogAiView" mode="edit" :catalog-key="route.catalogKey" @back="goBackOrFallback" @navigate="navigate" />
    <CatalogDetailView v-else-if="route.page === 'catalog-view'" :catalog-key="route.catalogKey" @navigate="navigate" />
    <CatalogEditorView v-else-if="catalogEditRoute" :mode="catalogEditRoute.mode" :catalog-key="catalogEditRoute.catalogKey" @navigate="navigate" />
    <DeviceScanView v-else-if="route.page === 'scan'" @navigate="navigate" />
    <TestDeviceView v-else-if="route.page === 'test-device'" :key="routeUrl(route)" :route="route" @navigate="navigate" />
    <TestGroupListView v-else-if="route.page === 'test-group-list'" @navigate="navigate" />
    <TestGroupEditorView v-else-if="route.page === 'test-group-add'" @navigate="navigate" />
    <TestGroupEditorView v-else-if="route.page === 'test-group-edit'" :group-id="route.groupId" @navigate="navigate" />
    <TestGroupRunView v-else-if="route.page === 'test-group-run'" :group-id="route.groupId" @navigate="navigate" />
    <CatalogEditorView v-else-if="route.page === 'catalog-add'" mode="add" :observed-baud-rate="route.observedBaudRate" :observed-slave-id="route.observedSlaveId" @navigate="navigate" />
  </AppShell>
</template>
