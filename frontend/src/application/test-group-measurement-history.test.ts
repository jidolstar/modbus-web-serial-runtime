import { describe, expect, it } from 'vitest'
import catalog from '@modbus-studio/device-catalog-domain/examples/cwt-th04s.bundle.json'
import { DeviceProfileValidator } from '../device-catalog/device-profile-validator'
import { SerialFlowControl, SerialParity } from '../serial/serial-types'
import type { TestGroupRuntimeSnapshot } from './test-group'
import type { TestGroupNodeResult } from './test-group-runner'
import {
  createAutomaticMeasurementCycle,
  MAX_AUTOMATIC_MEASUREMENT_CYCLES,
  TestGroupMeasurementHistory,
} from './test-group-measurement-history'

const bundle = new DeviceProfileValidator().validateCatalogBundle(catalog, 'fixture')
const snapshot: TestGroupRuntimeSnapshot = {
  group: {
    id: 1,
    name: '온습도 그룹',
    revision: 1,
    serialConfig: { baudRate: 4_800, dataBits: 8, stopBits: 1, parity: SerialParity.None, flowControl: SerialFlowControl.None },
    nodes: [{ id: 10, name: '창고 센서', catalogKey: 'cwt-th04s', slaveId: 3, position: 0 }],
    createdAt: '',
    updatedAt: '',
  },
  catalogs: { 'cwt-th04s': bundle },
}

describe('TestGroupMeasurementHistory', () => {
  it('성공한 Recipe output을 장비 정보와 cycle 시작시각에 묶는다', () => {
    const startedAt = new Date('2026-10-12T01:02:03.000Z')
    const results: TestGroupNodeResult[] = [{
      nodeId: 10,
      status: 'succeeded',
      outputs: {
        humidity: { value: 59.5, display: { text: '59.5', unit: '%RH' } },
        temperature: { value: 24.1, display: { text: '24.1', unit: '°C' } },
      },
      startedAt,
      finishedAt: new Date('2026-10-12T01:02:04.000Z'),
      cycle: 1,
    }]

    const cycle = createAutomaticMeasurementCycle(snapshot, 1, startedAt, results)

    expect(cycle).toMatchObject({
      cycle: 1,
      startedAt,
      devices: [{
        nodeId: 10,
        deviceInfo: { name: '창고 센서', catalogKey: 'cwt-th04s', manufacturer: 'CWT', model: 'CWT-TH04S' },
        communicationTarget: { slaveId: 3, serialConfig: { baudRate: 4_800 } },
        status: 'succeeded',
        data: [
          { key: 'humidity', value: 59.5, isSuccess: true, unit: '%RH' },
          { key: 'temperature', value: 24.1, isSuccess: true, unit: '°C' },
        ],
      }],
    })
    expect(Object.isFrozen(cycle.devices[0].data)).toBe(true)
  })

  it('실패하거나 결과에 없는 output은 빈 값과 실패 상태로 남긴다', () => {
    const results: TestGroupNodeResult[] = [{
      nodeId: 10,
      status: 'timeout',
      outputs: {},
      startedAt: new Date(),
      finishedAt: new Date(),
      cycle: 1,
    }]

    const cycle = createAutomaticMeasurementCycle(snapshot, 1, new Date(), results)

    expect(cycle.devices[0].status).toBe('timeout')
    expect(cycle.devices[0].data).toEqual([
      { key: 'humidity', value: '', isSuccess: false, unit: '%RH' },
      { key: 'temperature', value: '', isSuccess: false, unit: '°C' },
    ])
  })

  it('cycle 순서로 누적하고 상한 이후 추가를 거부하며 reset에서 비운다', () => {
    const history = new TestGroupMeasurementHistory()
    const emptyCycle = (cycle: number) => Object.freeze({ cycle, startedAt: new Date(0), devices: Object.freeze([]) })

    for (let cycle = 1; cycle <= MAX_AUTOMATIC_MEASUREMENT_CYCLES; cycle += 1) {
      expect(history.append(emptyCycle(cycle))).toBe(true)
    }

    expect(history.count).toBe(MAX_AUTOMATIC_MEASUREMENT_CYCLES)
    expect(history.append(emptyCycle(MAX_AUTOMATIC_MEASUREMENT_CYCLES + 1))).toBe(false)
    history.reset()
    expect(() => history.append(emptyCycle(2))).toThrow(/cycle 순서/)
    history.reset()
    expect(history.count).toBe(0)
    expect(history.append(emptyCycle(1))).toBe(true)
  })
})
