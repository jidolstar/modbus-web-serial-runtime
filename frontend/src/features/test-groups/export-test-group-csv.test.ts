import { describe, expect, it } from 'vitest'
import { SerialFlowControl, SerialParity } from '../../serial/serial-types'
import type { AutomaticDeviceMeasurement } from '../../application/test-group-measurement-history'
import { deviceMeasurementCsvFileName, formatDeviceMeasurementCsv } from './export-test-group-csv'

const device: AutomaticDeviceMeasurement = {
  nodeId: 10,
  deviceInfo: { name: '창고, "A"', catalogKey: 'cwt-th04s', manufacturer: 'CWT', model: 'CWT-TH04S' },
  communicationTarget: {
    slaveId: 3,
    serialConfig: { baudRate: 4_800, dataBits: 8, stopBits: 1, parity: SerialParity.None, flowControl: SerialFlowControl.None },
  },
  status: 'succeeded',
  data: [
    { key: 'humidity', value: 59.5, isSuccess: true, unit: '%RH' },
    { key: 'temperature', value: 24.1, isSuccess: true, unit: '°C' },
  ],
}

describe('formatDeviceMeasurementCsv', () => {
  it('UTF-8 BOM, CSV quoting, cycle 정보와 output 성공 여부를 만든다', () => {
    const csv = formatDeviceMeasurementCsv([{
      cycle: 1,
      startedAt: new Date('2026-10-12T01:02:03.000Z'),
      device,
    }])

    expect(csv.startsWith('\uFEFF"cycle","startedAt"')).toBe(true)
    expect(csv).toContain('"humidity (%RH)","humidity_isSuccess"')
    expect(csv).toContain('"창고, ""A"""')
    expect(csv).toContain('"2026-10-12T01:02:03.000Z"')
    expect(csv).toContain('"59.5","true","24.1","true"\r\n')
  })

  it('실패 측정값은 빈 셀과 false로 출력하고 수식 문자열은 안전하게 바꾼다', () => {
    const failedDevice: AutomaticDeviceMeasurement = {
      ...device,
      deviceInfo: { ...device.deviceInfo, name: '=1+1' },
      status: 'timeout',
      data: [
        { key: 'humidity', value: '', isSuccess: false, unit: '%RH' },
        { key: 'temperature', value: '', isSuccess: false, unit: '°C' },
      ],
    }
    const csv = formatDeviceMeasurementCsv([{ cycle: 2, startedAt: new Date(0), device: failedDevice }])

    expect(csv).toContain("\"'=1+1\"")
    expect(csv).toContain('"","false","","false"')
  })

  it('cycle 사이 output key가 달라도 모든 열을 유지한다', () => {
    const extraOutputDevice: AutomaticDeviceMeasurement = {
      ...device,
      data: [...device.data, { key: 'quality', value: 98, isSuccess: true }],
    }
    const csv = formatDeviceMeasurementCsv([
      { cycle: 1, startedAt: new Date(0), device },
      { cycle: 2, startedAt: new Date(1), device: extraOutputDevice },
    ])

    expect(csv).toContain('"quality","quality_isSuccess"')
    expect(csv.split('\r\n')[1]).toContain('"","false"')
    expect(csv.split('\r\n')[2]).toContain('"98","true"')
  })

  it('장비명을 파일명에 안전하게 사용하고 Windows 예약 이름은 대체한다', () => {
    expect(deviceMeasurementCsvFileName(device)).toBe('test-group-창고, _A_-slave-3.csv')
    expect(deviceMeasurementCsvFileName({ ...device, deviceInfo: { ...device.deviceInfo, name: 'CON' } }))
      .toBe('test-group-node-10-slave-3.csv')
  })
})
