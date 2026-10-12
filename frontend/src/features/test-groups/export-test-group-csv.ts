import type { AutomaticDeviceMeasurement } from '../../application/test-group-measurement-history'

export interface DeviceMeasurementCsvRow {
  readonly cycle: number // 실행 중 저장한 순환 측정 번호
  readonly startedAt: Date // cycle 첫 장비 요청 시각
  readonly device: AutomaticDeviceMeasurement // CSV 파일 하나에 내보낼 장비 결과
}

const CSV_FORMULA_PREFIX = /^[\s\u0000-\u001F]*[=+\-@]/u
const WINDOWS_RESERVED_FILE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu

/** 선택한 node의 자동 측정 cycle을 Excel 호환 UTF-8 CSV 문자열로 만든다. */
export function formatDeviceMeasurementCsv(rows: ReadonlyArray<DeviceMeasurementCsvRow>): string {
  const firstDevice = rows[0]?.device
  if (!firstDevice) return '\uFEFF'

  const outputColumns = collectOutputColumns(rows)
  const headers = [
    'cycle', 'startedAt', 'nodeId', 'deviceName', 'catalogKey', 'manufacturer', 'model',
    'slaveId', 'baudRate', 'dataBits', 'parity', 'stopBits', 'flowControl', 'status',
    ...outputColumns.flatMap(({ key, unit }) => [unit ? `${key} (${unit})` : key, `${key}_isSuccess`]),
  ]
  const lines = [headers, ...rows.map(({ cycle, startedAt, device }) => {
    const dataByKey = new Map(device.data.map((item) => [item.key, item]))
    const values: Array<string | number | boolean> = [
      cycle,
      startedAt.toISOString(),
      device.nodeId,
      device.deviceInfo.name,
      device.deviceInfo.catalogKey,
      device.deviceInfo.manufacturer,
      device.deviceInfo.model,
      device.communicationTarget.slaveId,
      device.communicationTarget.serialConfig.baudRate,
      device.communicationTarget.serialConfig.dataBits,
      device.communicationTarget.serialConfig.parity,
      device.communicationTarget.serialConfig.stopBits,
      device.communicationTarget.serialConfig.flowControl,
      device.status,
    ]

    for (const { key } of outputColumns) {
      const item = dataByKey.get(key)
      values.push(item?.value ?? '', item?.isSuccess ?? false)
    }

    return values
  })]

  return `\uFEFF${lines.map((line) => line.map(formatCsvCell).join(',')).join('\r\n')}\r\n`
}

/** 장비명에서 경로·예약 문자를 제거해 브라우저가 파일명으로만 사용하게 한다. */
export function deviceMeasurementCsvFileName(device: AutomaticDeviceMeasurement): string {
  const safeName = device.deviceInfo.name
    .replace(/[<>:"/\\|?*\u0000-\u001F]/gu, '_')
    .replace(/[. ]+$/u, '')
    .trim()
    .slice(0, 80)
  const fileNamePart = safeName && !WINDOWS_RESERVED_FILE_NAME.test(safeName) ? safeName : `node-${device.nodeId}`
  return `test-group-${fileNamePart}-slave-${device.communicationTarget.slaveId}.csv`
}

function collectOutputColumns(rows: ReadonlyArray<DeviceMeasurementCsvRow>): ReadonlyArray<{ readonly key: string; readonly unit?: string }> {
  const columns = new Map<string, { readonly key: string; readonly unit?: string }>()
  for (const { device } of rows) {
    for (const item of device.data) {
      if (!columns.has(item.key)) columns.set(item.key, Object.freeze({ key: item.key, ...(item.unit ? { unit: item.unit } : {}) }))
    }
  }
  return [...columns.values()]
}

function formatCsvCell(value: string | number | boolean): string {
  const text = String(value)
  const safeText = typeof value === 'string' && CSV_FORMULA_PREFIX.test(text) ? `'${text}` : text
  return `"${safeText.replaceAll('"', '""')}"`
}
