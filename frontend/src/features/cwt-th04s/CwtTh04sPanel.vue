<script setup lang="ts">
import { useCwtTh04sRuntime } from './use-cwt-th04s-runtime'

const {
  connectionDescription, connectionLabel, connect, disconnect, errorMessage, humidity,
  isConnected, isConnectionTransitioning, isSupported, lastRx, lastTx, lastUpdatedAt, temperature,
} = useCwtTh04sRuntime()
</script>

<template>
  <section class="sensor-panel">
    <header class="sensor-header">
      <div>
        <p class="eyebrow">CWT-TH04S · WEB SERIAL TEST</p>
        <h2>온습도 측정</h2>
        <p class="description">{{ connectionDescription }}</p>
      </div>
      <span class="status" :class="{ connected: isConnected }">{{ connectionLabel }}</span>
    </header>
    <div v-if="!isSupported" class="notice error">Web Serial API를 지원하는 데스크톱 Chrome 또는 Edge에서 HTTPS로 접속해 주세요.</div>
    <section class="readings" aria-live="polite">
      <article><span>온도</span><strong>{{ temperature === null ? '--.-' : temperature.toFixed(1) }}</strong><small>℃</small></article>
      <article><span>습도</span><strong>{{ humidity === null ? '--.-' : humidity.toFixed(1) }}</strong><small>%RH</small></article>
    </section>
    <div class="actions">
      <button v-if="!isConnected" :disabled="!isSupported || isConnectionTransitioning" @click="connect">
        {{ isConnectionTransitioning ? '연결 처리 중…' : 'Serial Port 연결' }}
      </button>
      <button v-else class="secondary" @click="disconnect">연결 해제</button>
      <span>마지막 수신: {{ lastUpdatedAt ?? '-' }}</span>
    </div>
    <p v-if="errorMessage" class="notice error">{{ errorMessage }}</p>
    <details>
      <summary>최근 Modbus 프레임</summary>
      <dl><dt>TX</dt><dd>{{ lastTx || '-' }}</dd><dt>RX</dt><dd>{{ lastRx || '-' }}</dd></dl>
    </details>
  </section>
</template>
