<script setup lang="ts">
import { computed, toRef, watch } from 'vue'
import type { TestDevice } from '../../application/test-device'
import type { CatalogDetail } from '../../device-catalog/catalog-api'
import { useTestDeviceRuntime } from './use-test-device-runtime'

const props = defineProps<{ readonly device: TestDevice; readonly catalog: CatalogDetail }>()
const emit = defineEmits<{ connectionChange: [connected: boolean] }>()
const runtime = useTestDeviceRuntime(toRef(props, 'device'), props.catalog)
const connectionDescription = computed(() => `${props.device.serialConfig.baudRate.toLocaleString()} baud · ${props.device.serialConfig.dataBits}${props.device.serialConfig.parity.charAt(0).toUpperCase()}${props.device.serialConfig.stopBits} · Slave ID ${props.device.slaveId}`)
watch(runtime.isConnected, (connected) => emit('connectionChange', connected), { immediate: true })
defineExpose({ connect: runtime.connect, disconnect: runtime.disconnect, isConnected: runtime.isConnected, isTransitioning: runtime.isTransitioning })
</script>

<template>
  <section class="sensor-panel surface-card test-device-runtime">
    <header class="sensor-header"><div><p class="eyebrow">LIVE TEST</p><h2>장비 측정</h2><p class="description">{{ connectionDescription }}</p></div><span class="status-badge" :class="{ connected: runtime.isConnected.value }"><i />{{ runtime.connectionLabel.value }}</span></header>
    <p v-if="!runtime.isSupported" class="notice error">Web Serial API를 지원하는 데스크톱 Chrome 또는 Edge에서 HTTPS로 접속해 주세요.</p>
    <div v-if="runtime.measurementOptions.length > 1" class="measurement-selector"><label>측정 항목<select v-model="runtime.selectedRecipeId.value" :disabled="runtime.isTransitioning.value" @change="runtime.selectMeasurement"><option v-for="recipe in runtime.measurementOptions" :key="recipe.id" :value="recipe.id">{{ recipe.name }}</option></select></label></div>
    <section class="readings dynamic" aria-live="polite">
      <article v-for="output in runtime.outputs.value" :key="output.name"><span>{{ output.name }}</span><div><strong>{{ output.displayValue }}</strong><small v-if="output.unit">{{ output.unit }}</small></div></article>
      <p v-if="!runtime.outputs.value.length" class="empty-copy">연결하면 Catalog가 정의한 측정값이 여기에 표시됩니다.</p>
    </section>
    <div class="actions"><span class="last-updated">마지막 수신 <strong>{{ runtime.lastUpdatedAt.value ?? '-' }}</strong></span></div>
    <p v-if="runtime.errorMessage.value" class="notice error">{{ runtime.errorMessage.value }}</p>
    <details><summary>최근 Modbus 프레임</summary><dl><dt>TX</dt><dd>{{ runtime.lastTx.value || '-' }}</dd><dt>RX</dt><dd>{{ runtime.lastRx.value || '-' }}</dd></dl></details>
  </section>
</template>
