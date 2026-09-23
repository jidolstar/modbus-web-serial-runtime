<script setup lang="ts">
import type { AuthUser } from '../auth/auth-api'
import CwtTh04sPanel from '../features/cwt-th04s/CwtTh04sPanel.vue'
import AppShell from '../layout/AppShell.vue'

defineProps<{ readonly user: AuthUser; readonly isLoggingOut: boolean }>()
defineEmits<{ logout: [] }>()
</script>
<template>
  <AppShell :user="user" :is-logging-out="isLoggingOut" @logout="$emit('logout')">
    <header class="page-heading">
      <div><p class="eyebrow">DEVICE OPERATIONS</p><h1>장비 대시보드</h1><p class="description">연결 상태와 실시간 측정값을 한곳에서 확인합니다.</p></div>
      <span class="page-date">브라우저 로컬 실행</span>
    </header>
    <section class="summary-grid" aria-label="시스템 요약">
      <article class="summary-card"><span class="summary-icon blue" aria-hidden="true">▦</span><div><span>장비 카탈로그</span><strong>DB 전환 준비</strong><small>새 관리 구조를 구축하고 있습니다.</small></div></article>
      <article class="summary-card"><span class="summary-icon green" aria-hidden="true">⌁</span><div><span>통신 실행 위치</span><strong>이 브라우저</strong><small>장비 데이터는 로컬에서 처리됩니다.</small></div></article>
      <article class="summary-card"><span class="summary-icon amber" aria-hidden="true">◉</span><div><span>테스트 프로필</span><strong>CWT-TH04S</strong><small>온·습도 측정 프로필</small></div></article>
    </section>
    <CwtTh04sPanel />
  </AppShell>
</template>
