<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { AuthUser } from '../auth/auth-api'

const props = withDefaults(defineProps<{
  readonly user: AuthUser
  readonly isLoggingOut: boolean
  readonly activeSection?: 'dashboard' | 'catalogs' | 'scan'
}>(), { activeSection: 'dashboard' })
const emit = defineEmits<{ logout: []; navigate: [section: 'dashboard' | 'catalogs' | 'scan'] }>()

const isNavigationOpen = ref(false)
const userInitial = computed(() => (props.user.displayName || props.user.email).trim().charAt(0).toUpperCase())

function closeNavigation(): void { isNavigationOpen.value = false }
function handleEscape(event: KeyboardEvent): void { if (event.key === 'Escape') closeNavigation() }
function navigate(section: 'dashboard' | 'catalogs' | 'scan'): void { emit('navigate', section); closeNavigation() }

watch(isNavigationOpen, (isOpen) => document.body.classList.toggle('navigation-open', isOpen))
window.addEventListener('keydown', handleEscape)
onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscape)
  document.body.classList.remove('navigation-open')
})
</script>

<template>
  <div class="app-shell">
    <button v-if="isNavigationOpen" class="navigation-backdrop" type="button" aria-label="메뉴 닫기" @click="closeNavigation" />
    <aside id="primary-navigation" class="app-sidebar" :class="{ open: isNavigationOpen }">
      <div class="brand">
        <span class="brand-mark" aria-hidden="true">M</span>
        <div><strong>Modbus Manager</strong><span>Device Operations</span></div>
      </div>
      <nav class="primary-navigation" aria-label="주 메뉴">
        <p>WORKSPACE</p>
        <button class="navigation-item" :class="{ active: activeSection === 'dashboard' }" type="button" :aria-current="activeSection === 'dashboard' ? 'page' : undefined" @click="navigate('dashboard')"><span class="navigation-icon" aria-hidden="true">⌂</span>대시보드</button>
        <button class="navigation-item" :class="{ active: activeSection === 'catalogs' }" type="button" :aria-current="activeSection === 'catalogs' ? 'page' : undefined" @click="navigate('catalogs')"><span class="navigation-icon" aria-hidden="true">▦</span>장비 카탈로그</button>
        <button class="navigation-item" :class="{ active: activeSection === 'scan' }" type="button" :aria-current="activeSection === 'scan' ? 'page' : undefined" @click="navigate('scan')"><span class="navigation-icon" aria-hidden="true">⌁</span>장비 스캔</button>
        <span class="navigation-item disabled"><span class="navigation-icon" aria-hidden="true">✓</span>테스트 그룹<small>준비 중</small></span>
      </nav>
      <div class="sidebar-footer">
        <span class="environment-indicator"><i /> 시스템 온라인</span>
        <span>Web Serial 기반 장비 관리</span>
      </div>
    </aside>
    <div class="app-workspace">
      <header class="topbar">
        <button class="menu-button icon-button" type="button" aria-label="메뉴 열기" aria-controls="primary-navigation" :aria-expanded="isNavigationOpen" @click="isNavigationOpen = !isNavigationOpen"><span aria-hidden="true">☰</span></button>
        <div class="topbar-context"><span>장비 운영</span><strong>{{ activeSection === 'catalogs' ? '장비 카탈로그' : activeSection === 'scan' ? '장비 스캔' : '대시보드' }}</strong></div>
        <div class="user-menu">
          <span class="avatar" aria-hidden="true">{{ userInitial }}</span>
          <span class="user-copy"><strong>{{ user.displayName || '관리자' }}</strong><small>{{ user.email }}</small></span>
          <button class="button button-ghost button-compact" type="button" :disabled="isLoggingOut" @click="$emit('logout')">{{ isLoggingOut ? '처리 중…' : '로그아웃' }}</button>
        </div>
      </header>
      <main id="dashboard" class="app-content"><slot /></main>
    </div>
  </div>
</template>
