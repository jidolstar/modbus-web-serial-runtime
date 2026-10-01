import cwtBundle from '../../../common/device-catalog-domain/examples/cwt-th04s.bundle.json'
import { describe, expect, it } from 'vitest'
import type { CatalogDetail } from '../device-catalog/catalog-api'
import { checkTestDeviceCatalogCompatibility, createTestDevice } from './test-device'

const CATALOG = {
  catalogKey: 'cwt-th04s', title: 'CWT 온습도 센서', manufacturer: 'CWT', model: 'CWT-TH04S',
  schemaVersion: '1.0', revision: 3, enabled: true, usesExtensions: false, hasThumbnail: false,
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', definition: cwtBundle,
} as CatalogDetail

describe('createTestDevice', () => {
  it('Catalog 기본 serial 설정에 사용자가 선택한 baudrate와 Slave ID를 결합한다', () => {
    expect(createTestDevice(CATALOG, { name: ' 센서 1 ', baudRate: 9600, slaveId: 7, origin: 'catalog' })).toEqual({
      name: '센서 1', catalogKey: 'cwt-th04s', catalogRevision: 3,
      serialConfig: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' },
      slaveId: 7, origin: 'catalog',
    })
  })

  it('Catalog 지원 범위를 벗어난 값과 빈 이름을 거부한다', () => {
    expect(() => createTestDevice(CATALOG, { name: '', baudRate: 4800, slaveId: 1, origin: 'catalog' })).toThrow(/이름/)
    expect(() => createTestDevice(CATALOG, { name: '센서', baudRate: 115200, slaveId: 1, origin: 'scan' })).toThrow(/baudrate/)
    expect(() => createTestDevice(CATALOG, { name: '센서', baudRate: 4800, slaveId: 248, origin: 'scan' })).toThrow(/Slave ID/)
  })

  it('Scan 관찰값과 Catalog 허용 범위의 불일치를 필드별로 구분한다', () => {
    expect(checkTestDeviceCatalogCompatibility(CATALOG, 9600, 247)).toEqual({ baudRateSupported: true, slaveIdSupported: true })
    expect(checkTestDeviceCatalogCompatibility(CATALOG, 115200, 248)).toEqual({ baudRateSupported: false, slaveIdSupported: false })
    expect(checkTestDeviceCatalogCompatibility(CATALOG, null, null)).toEqual({ baudRateSupported: false, slaveIdSupported: false })
  })
})
