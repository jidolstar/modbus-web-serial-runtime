import { describe, expect, it } from 'vitest'
import { ModbusTimeoutError } from '../modbus/modbus-errors'
import type { ModbusClient } from '../modbus/modbus-types'
import { MockSerialTransport } from '../serial/testing/mock-serial-transport'
import { CatalogAwareScanner, CatalogScanStage, CatalogScanStatus, STANDARD_MODBUS_BAUD_RATES } from './catalog-aware-scanner'
import { OperationAbortedError } from './operation-errors'

const RESPONDING_CLIENT: ModbusClient = {
  readHoldingRegisters: async () => [1],
  writeSingleRegister: async () => undefined,
}

describe('CatalogAwareScanner', () => {
  it('현장용 표준 baudrate에서 저속 300과 600을 제외한다', () => {
    expect(STANDARD_MODBUS_BAUD_RATES).toEqual([1_200, 2_400, 4_800, 9_600, 19_200, 38_400, 57_600, 115_200])
  })

  it('응답한 조합만 발견 결과로 반환하고 timeout 조합은 제외한다', async () => {
    const client: ModbusClient = {
      readHoldingRegisters: async (slaveId) => {
        if (slaveId === 2) throw new ModbusTimeoutError('timeout')
        return [1]
      },
      writeSingleRegister: async () => undefined,
    }
    const transport = new MockSerialTransport()
    await transport.requestPort()
    const scanner = new CatalogAwareScanner(transport, client, 0)
    const results = await scanner.scan({ baudRates: [4_800], slaveIds: [1, 2] })
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ slaveId: 1, status: CatalogScanStatus.Discovered })
  })

  it('각 baudrate에서 시작~종료 Slave ID 전체를 빠짐없이 순회한다', async () => {
    const transport = new MockSerialTransport()
    await transport.requestPort()
    const scanner = new CatalogAwareScanner(transport, RESPONDING_CLIENT, 0)
    const startedTargets: string[] = []
    await scanner.scan({ baudRates: [4_800, 9_600], slaveIds: [1, 2] }, (progress) => {
      if (progress.stage !== CatalogScanStage.Discovery) return
      const key = `${progress.currentSerialConfig.baudRate}/${progress.currentSlaveId}`
      if (startedTargets.at(-1) !== key) startedTargets.push(key)
    })
    expect(startedTargets).toEqual(['4800/1', '4800/2', '9600/1', '9600/2'])
  })

  it('완료 callback에서 취소하면 다음 Slave ID를 요청하지 않는다', async () => {
    const calls: number[] = []
    const client: ModbusClient = {
      readHoldingRegisters: async (slaveId) => { calls.push(slaveId); return [1] },
      writeSingleRegister: async () => undefined,
    }
    const transport = new MockSerialTransport()
    await transport.requestPort()
    const scanner = new CatalogAwareScanner(transport, client, 0)
    const controller = new AbortController()
    const operation = scanner.scan({ baudRates: [9_600], slaveIds: [1, 2] }, ({ completed }) => {
      if (completed === 1) controller.abort()
    }, controller.signal)
    await expect(operation).rejects.toBeInstanceOf(OperationAbortedError)
    expect(calls).toEqual([1])
  })
})
