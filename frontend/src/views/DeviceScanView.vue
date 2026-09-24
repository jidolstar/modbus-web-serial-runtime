<script setup lang="ts">
import { CatalogScanStatus, type CatalogScanResult } from '../application/catalog-aware-scanner'
import type { AppRoute } from '../device-catalog/catalog-route'
import { useCatalogScan } from '../features/scan/use-catalog-scan'
import HelpTooltip from '../components/HelpTooltip.vue'
import { HELP_TOOLTIP_COPY } from '../components/help-tooltip-copy'

const emit = defineEmits<{ navigate: [route: AppRoute] }>()
const {
  availableBaudRates, cancelScan, completed, currentBaudRate, currentSlaveId, discoveredCount,
  errorMessage, isSupported, progressPercent, results, scanning, selectedBaudRates,
  slaveIdEnd, slaveIdStart, startScan, statusLabel, total,
} = useCatalogScan()

function statusClass(status: CatalogScanStatus): string {
  return status === CatalogScanStatus.Discovered ? 'success' : 'muted'
}

function registerUnknown(result: CatalogScanResult): void {
  emit('navigate', { page: 'catalog-add', observedBaudRate: result.serialConfig.baudRate, observedSlaveId: result.slaveId })
}
</script>

<template>
  <header class="page-heading">
    <div><p class="eyebrow">DEVICE DISCOVERY</p><h1>장비 스캔</h1><p class="description help-label">표준 8N1 <HelpTooltip label="8N1" :text="HELP_TOOLTIP_COPY.serial8N1" /> 조합에서 응답하는 Modbus 장비의 Baudrate와 Slave ID를 찾습니다.</p></div>
    <span class="page-date">원시 통신 데이터는 서버로 전송하지 않습니다.</span>
  </header>

  <p v-if="!isSupported" class="notice error">Web Serial API를 지원하는 데스크톱 Chrome 또는 Edge에서 HTTPS로 접속해 주세요.</p>
  <p v-if="errorMessage" class="notice" :class="errorMessage.includes('취소') ? 'warning' : 'error'">{{ errorMessage }}</p>

  <section class="surface-card scan-config-panel">
    <div class="section-heading"><div><h2 class="help-label">스캔 범위 <HelpTooltip label="스캔 범위" :text="HELP_TOOLTIP_COPY.scanRange" /></h2><p>범위를 좁힐수록 장비 탐색이 빠르게 끝납니다.</p></div></div>
    <fieldset class="scan-baud-options" :disabled="scanning">
      <legend><span class="help-label">Baudrate <HelpTooltip label="Baudrate" :text="HELP_TOOLTIP_COPY.baudRate" /></span></legend>
      <label v-for="baudRate in availableBaudRates" :key="baudRate"><input v-model="selectedBaudRates" type="checkbox" :value="baudRate">{{ baudRate.toLocaleString() }}</label>
    </fieldset>
    <div class="scan-range-fields">
      <div class="form-field"><span class="field-label"><label for="scan-slave-start">시작 Slave ID</label><HelpTooltip label="시작 Slave ID" :text="HELP_TOOLTIP_COPY.slaveId" /></span><input id="scan-slave-start" v-model.number="slaveIdStart" type="number" min="1" max="247" inputmode="numeric"></div>
      <div class="form-field"><span class="field-label"><label for="scan-slave-end">종료 Slave ID</label><HelpTooltip label="종료 Slave ID" :text="HELP_TOOLTIP_COPY.slaveId" /></span><input id="scan-slave-end" v-model.number="slaveIdEnd" type="number" min="1" max="247" inputmode="numeric"></div>
    </div>
    <div class="scan-actions">
      <button v-if="!scanning" class="button button-primary" type="button" :disabled="!isSupported" @click="startScan">Serial Port 선택 후 스캔</button>
      <button v-else class="button button-secondary" type="button" @click="cancelScan">스캔 취소</button>
    </div>
  </section>

  <section v-if="scanning || total > 0" class="surface-card scan-progress" aria-live="polite">
    <div><strong>{{ scanning ? '장비 스캔 중' : '스캔 완료' }}</strong><span>{{ completed }} / {{ total }} 조합</span></div>
    <p v-if="scanning && currentBaudRate !== null && currentSlaveId !== null" class="scan-current-target">{{ currentBaudRate.toLocaleString() }} baud · Slave ID {{ currentSlaveId }} 스캔 중</p>
    <progress :value="completed" :max="Math.max(total, 1)">{{ progressPercent }}%</progress>
    <div class="scan-counts"><span>발견 {{ discoveredCount }}대</span></div>
  </section>

  <section class="surface-card scan-results-panel">
    <div class="section-heading"><div><h2 class="help-label">스캔 결과 <HelpTooltip label="스캔 결과" :text="HELP_TOOLTIP_COPY.scanResults" /></h2><p>응답한 통신 조합만 표시하며 장비 모델을 자동으로 추정하지 않습니다.</p></div><span>{{ results.length }}건</span></div>
    <div v-if="results.length" class="scan-result-list">
      <article v-for="result in results" :key="`${result.serialConfig.baudRate}:${result.serialConfig.dataBits}:${result.serialConfig.parity}:${result.serialConfig.stopBits}:${result.serialConfig.flowControl}:${result.slaveId}`" class="scan-result-row">
        <div class="scan-result-address"><strong>ID {{ result.slaveId }}</strong><span>{{ result.serialConfig.baudRate.toLocaleString() }} baud · {{ result.serialConfig.dataBits }}{{ result.serialConfig.parity.charAt(0).toUpperCase() }}{{ result.serialConfig.stopBits }}</span></div>
        <span class="scan-result-status"><span class="status-pill" :class="statusClass(result.status)">{{ statusLabel(result.status) }}</span><HelpTooltip label="발견 상태" :text="HELP_TOOLTIP_COPY.discovered" /></span>
        <div class="scan-result-copy">
          <span>Modbus 응답을 확인했습니다. 사용할 Catalog는 사용자가 직접 지정합니다.</span>
        </div>
        <button class="button button-ghost button-small" type="button" @click="registerUnknown(result)">새 카탈로그 등록</button>
      </article>
    </div>
    <p v-else class="empty-copy">아직 스캔 결과가 없습니다.</p>
  </section>
</template>
