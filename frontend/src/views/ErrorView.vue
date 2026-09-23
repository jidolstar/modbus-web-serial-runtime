<script setup lang="ts">
defineEmits<{ retry: [] }>()
</script>
<template>
  <main class="auth-card">
    <p class="eyebrow">CONNECTION ERROR</p><h1>인증 서비스를 확인할 수 없습니다</h1>
    <p class="description">잠시 후 다시 시도해 주세요.</p><button @click="$emit('retry')">다시 시도</button>
  </main>
</template>
