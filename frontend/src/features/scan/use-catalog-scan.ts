import { computed, onBeforeUnmount, ref } from 'vue'
import { CatalogAwareScanner, CatalogScanStage, CatalogScanStatus, STANDARD_MODBUS_BAUD_RATES, type CatalogScanResult } from '../../application/catalog-aware-scanner'
import { OperationAbortedError } from '../../application/operation-errors'
import { RUNTIME_CONFIG } from '../../application/runtime-config'
import { ModbusRtuClient } from '../../modbus/modbus-rtu-client'
import { WebSerialTransport } from '../../serial/web-serial-transport'

const DEFAULT_SLAVE_ID_START = 1 // 첫 화면에서 과도한 전수 탐색을 피하기 위한 시작값. 예: 1
const DEFAULT_SLAVE_ID_END = 10 // 사용자가 필요할 때 247까지 확장할 수 있는 초기 종료값. 예: 10

const STATUS_LABELS: Readonly<Record<CatalogScanStatus, string>> = Object.freeze({
  [CatalogScanStatus.Discovered]: '응답 확인',
})

/** Scan 화면이 Catalog 로드, Web Serial 수명주기와 진행 상태를 Vue 상태로 연결한다. */
export function useCatalogScan() {
  const transport = new WebSerialTransport()
  const modbusClient = new ModbusRtuClient(transport, RUNTIME_CONFIG.modbusTransactionTimeoutMs)
  const scanner = new CatalogAwareScanner(transport, modbusClient)
  const availableBaudRates = STANDARD_MODBUS_BAUD_RATES
  const selectedBaudRates = ref<number[]>([4_800, 9_600, 19_200])
  const slaveIdStart = ref(DEFAULT_SLAVE_ID_START)
  const slaveIdEnd = ref(DEFAULT_SLAVE_ID_END)
  const results = ref<ReadonlyArray<CatalogScanResult>>([])
  const completed = ref(0)
  const total = ref(0)
  const scanStage = ref<CatalogScanStage>(CatalogScanStage.Discovery)
  const currentBaudRate = ref<number | null>(null)
  const currentSlaveId = ref<number | null>(null)
  const scanning = ref(false)
  const errorMessage = ref<string | null>(null)
  let abortController: AbortController | null = null

  const isSupported = transport.isSupported
  const progressPercent = computed(() => total.value > 0 ? Math.round((completed.value / total.value) * 100) : 0)
  const discoveredCount = computed(() => results.value.length)

  /** 사용자의 명시적 버튼 클릭에서만 port 선택 UI를 열고 read-only FC03 Scan을 시작한다. */
  async function startScan(): Promise<void> {
    if (scanning.value || !isSupported) return
    if (!Number.isInteger(slaveIdStart.value) || !Number.isInteger(slaveIdEnd.value)
      || slaveIdStart.value < 1 || slaveIdEnd.value > 247 || slaveIdStart.value > slaveIdEnd.value) {
      errorMessage.value = 'Slave ID 범위는 1~247 안에서 시작값이 종료값보다 작거나 같아야 합니다.'
      return
    }
    if (selectedBaudRates.value.length === 0) {
      errorMessage.value = '하나 이상의 baudrate를 선택해 주세요.'
      return
    }

    scanning.value = true
    errorMessage.value = null
    results.value = []
    completed.value = 0
    total.value = 0
    scanStage.value = CatalogScanStage.Discovery
    currentBaudRate.value = null
    currentSlaveId.value = null
    abortController = new AbortController()
    try {
      await transport.requestPort()
      const slaveIds = Array.from({ length: slaveIdEnd.value - slaveIdStart.value + 1 }, (_, index) => slaveIdStart.value + index)
      results.value = await scanner.scan(
        { baudRates: selectedBaudRates.value, slaveIds },
        (progress) => {
          scanStage.value = progress.stage
          completed.value = progress.completed
          total.value = progress.total
          currentBaudRate.value = progress.currentSerialConfig.baudRate
          currentSlaveId.value = progress.currentSlaveId
          if (progress.result) {
            const resultKey = `${progress.result.serialConfig.baudRate}:${progress.result.serialConfig.dataBits}:${progress.result.serialConfig.parity}:${progress.result.serialConfig.stopBits}:${progress.result.serialConfig.flowControl}:${progress.result.slaveId}`
            const existingIndex = results.value.findIndex((item) => `${item.serialConfig.baudRate}:${item.serialConfig.dataBits}:${item.serialConfig.parity}:${item.serialConfig.stopBits}:${item.serialConfig.flowControl}:${item.slaveId}` === resultKey)
            const nextResults = [...results.value]
            if (existingIndex >= 0) nextResults[existingIndex] = progress.result
            else nextResults.push(progress.result)
            results.value = Object.freeze(nextResults)
          }
        },
        abortController.signal,
      )
    } catch (error) {
      if (error instanceof OperationAbortedError || abortController.signal.aborted) errorMessage.value = '장비 스캔을 취소했습니다.'
      else if (error instanceof DOMException && error.name === 'NotFoundError') errorMessage.value = 'Serial Port 선택을 취소했습니다.'
      else errorMessage.value = error instanceof Error ? error.message : '장비 스캔을 완료하지 못했습니다.'
    } finally {
      await transport.close().catch(() => undefined)
      abortController = null
      scanning.value = false
    }
  }

  function cancelScan(): void { abortController?.abort('사용자 취소') }
  function statusLabel(status: CatalogScanStatus): string { return STATUS_LABELS[status] }

  onBeforeUnmount(() => {
    abortController?.abort('화면 이동')
    modbusClient.dispose()
    void transport.dispose()
  })

  return {
    availableBaudRates, cancelScan, completed, currentBaudRate, currentSlaveId, discoveredCount,
    errorMessage, isSupported, progressPercent, results, scanning, scanStage, selectedBaudRates,
    slaveIdEnd, slaveIdStart, startScan, statusLabel, total,
  }
}
