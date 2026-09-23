<script setup lang="ts">
defineEmits<{ login: [] }>()
</script>
<template>
  <main class="auth-card">
    <p class="eyebrow">MODBUS MANAGER</p><h1>장비 관리에 로그인</h1>
    <p class="description">허용된 Google 계정으로 로그인해 장비 관리 기능을 사용하세요.</p>
    <button class="login-button" @click="$emit('login')">Google로 계속하기</button>
    <p class="security-note">인증 토큰은 브라우저 저장소에 저장되지 않습니다.</p>
  </main>
</template>
