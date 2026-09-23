<script setup lang="ts">
defineProps<{ readonly missing: readonly string[] }>()
</script>
<template>
  <main class="auth-card">
    <p class="eyebrow">SETUP REQUIRED</p><h1>Google 로그인 설정이 필요합니다</h1>
    <p class="description">관리자가 Backend 환경설정을 완료한 뒤 다시 접속해 주세요.</p>
    <div class="notice warning"><strong>누락된 설정</strong><ul><li v-for="setting in missing" :key="setting"><code>{{ setting }}</code></li></ul></div>
  </main>
</template>
