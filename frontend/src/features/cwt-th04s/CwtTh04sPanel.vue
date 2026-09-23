<script setup lang="ts">
import { useCwtTh04sRuntime } from './use-cwt-th04s-runtime'

const {
  connectionDescription, connectionLabel, connect, disconnect, errorMessage, humidity,
  isConnected, isConnectionTransitioning, isSupported, lastRx, lastTx, lastUpdatedAt, temperature,
} = useCwtTh04sRuntime()
</script>

<template>
  <section class="sensor-panel surface-card">
    <header class="sensor-header">
      <div>
        <p class="eyebrow">LIVE DEVICE</p>
        <h2>CWT-TH04S 온·습도 측정</h2>
        <p class="description">{{ connectionDescription }}</p>
      </div>
      <span class="status-badge" :class="{ connected: isConnected }"><i />{{ connectionLabel }}</span>
    </header>
    <div v-if="!isSupported" class="notice error">Web Serial API를 지원하는 데스크톱 Chrome 또는 Edge에서 HTTPS로 접속해 주세요.</div>
    <section class="readings" aria-live="polite">
      <article><span>현재 온도</span><div><strong>{{ temperature === null ? '--.-' : temperature.toFixed(1) }}</strong><small>℃</small></div></article>
      <article><span>현재 습도</span><div><strong>{{ humidity === null ? '--.-' : humidity.toFixed(1) }}</strong><small>%RH</small></div></article>
    </section>
    <div class="actions">
      <button v-if="!isConnected" class="button button-primary" :disabled="!isSupported || isConnectionTransitioning" @click="connect">
        {{ isConnectionTransitioning ? '연결 처리 중…' : 'Serial Port 연결' }}
      </button>
      <button v-else class="button button-secondary" @click="disconnect">연결 해제</button>
      <span class="last-updated">마지막 수신 <strong>{{ lastUpdatedAt ?? '-' }}</strong></span>
    </div>
    <p v-if="errorMessage" class="notice error">{{ errorMessage }}</p>
    <details>
      <summary>최근 Modbus 프레임</summary>
      <dl><dt>TX</dt><dd>{{ lastTx || '-' }}</dd><dt>RX</dt><dd>{{ lastRx || '-' }}</dd></dl>
    </details>
  </section>
</template>
