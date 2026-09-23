<script setup lang="ts">
import type { AuthUser } from '../auth/auth-api'
import CwtTh04sPanel from '../features/cwt-th04s/CwtTh04sPanel.vue'

defineProps<{ readonly user: AuthUser; readonly isLoggingOut: boolean }>()
defineEmits<{ logout: [] }>()
</script>
<template>
  <main class="dashboard">
    <header class="dashboard-header">
      <div><p class="eyebrow">MODBUS MANAGER</p><h1>장비 대시보드</h1><p class="description">{{ user.displayName || user.email }}</p></div>
      <div class="account-actions"><span>{{ user.email }}</span><button class="secondary" :disabled="isLoggingOut" @click="$emit('logout')">{{ isLoggingOut ? '로그아웃 중…' : '로그아웃' }}</button></div>
    </header>
    <CwtTh04sPanel />
  </main>
</template>
