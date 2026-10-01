<script setup lang="ts">
defineEmits<{ login: [] }>()
</script>
<template>
  <main class="auth-page">
    <section class="auth-intro" aria-labelledby="product-title">
      <p class="eyebrow">BROWSER-BASED MODBUS WORKSPACE</p>
      <h1 id="product-title">Modbus Studio</h1>
      <p class="auth-tagline">장비를 정의하고, 브라우저에서 연결하고, Recipe를 실행하세요.</p>
      <ol class="auth-flow" aria-label="Modbus Studio 사용 흐름">
        <li><span>01</span><div><strong>장비 정의</strong><small>Catalog의 Profile과 Recipe</small></div></li>
        <li><span>02</span><div><strong>브라우저 연결</strong><small>Web Serial로 RS485 탐색</small></div></li>
        <li><span>03</span><div><strong>측정과 설정</strong><small>Recipe 실행과 지원 설정</small></div></li>
      </ol>
      <p class="auth-serial-note">USB Serial 통신은 사용자 브라우저에서 실행됩니다.</p>
    </section>
    <section class="auth-card" aria-labelledby="login-title">
      <p class="eyebrow">ADMIN WORKSPACE</p><h2 id="login-title">관리자 로그인</h2>
      <p class="description">허용된 Google 계정으로 로그인해 장비 Catalog와 관리 기능을 사용하세요.</p>
      <button class="login-button" type="button" @click="$emit('login')">Google로 계속하기</button>
      <p class="security-note">인증 토큰은 브라우저 저장소에 저장되지 않습니다.</p>
    </section>
  </main>
</template>
