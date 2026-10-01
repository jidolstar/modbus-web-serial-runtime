import { describe, expect, it, vi } from 'vitest'
import { RecipeExecutionStatus, type RecipeExecutionResult, type RecipeRunner } from '../recipe-engine/recipe-execution.types'
import { TestGroupRunner } from './test-group-runner'
import catalog from '@modbus-manager/device-catalog-domain/examples/cwt-th04s.bundle.json'
import { DeviceProfileValidator } from '../device-catalog/device-profile-validator'
import { SerialFlowControl, SerialParity } from '../serial/serial-types'
import type { TestGroup } from './test-group'
import { SerialDisconnectedError } from '../serial/serial-errors'
import { SerialDisconnectReason } from '../serial/serial-connection-state'
import { RecipeAbortedError } from '../recipe-engine/recipe-execution-errors'
import { ModbusTimeoutError } from '../modbus/modbus-errors'

const bundle = new DeviceProfileValidator().validateCatalogBundle(catalog, 'fixture')
const group: TestGroup = { id: 1, name: '그룹', revision: 1, serialConfig: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: SerialParity.None, flowControl: SerialFlowControl.None }, nodes: [{ id: 1, name: 'A', catalogKey: 'cwt-th04s', catalogRevision: 1, slaveId: 1, position: 0 }, { id: 2, name: 'B', catalogKey: 'cwt-th04s', catalogRevision: 1, slaveId: 2, position: 1 }], createdAt: '', updatedAt: '' }
class MockRunner implements RecipeRunner {
  public constructor(private readonly executeImplementation: RecipeRunner['execute']) {}
  public execute(...parameters: Parameters<RecipeRunner['execute']>): Promise<RecipeExecutionResult> { return this.executeImplementation(...parameters) }
}

describe('TestGroupRunner', () => {
  it('node를 순서대로 실행하고 한 node 실패 뒤에도 계속한다', async () => {
    const execute = vi.fn().mockRejectedValueOnce(new Error('first failed')).mockResolvedValueOnce({ recipeId: 'read', status: RecipeExecutionStatus.Succeeded, steps: [], outputs: {}, context: {} })
    const runner = new TestGroupRunner(new MockRunner(execute))
    await runner.run({ group, catalogs: { 'cwt-th04s': bundle } })
    expect(execute.mock.calls.map((call) => call[2])).toEqual([{ deviceId: 1 }, { deviceId: 2 }])
    expect(runner.snapshot.results.map(({ status }) => status)).toEqual(['recipe-error', 'succeeded'])
  })
  it('중복 실행을 거부한다', async () => {
    let resolve!: () => void; const pending = new Promise<void>((done) => { resolve = done })
    const execute = vi.fn(async () => { await pending; return { recipeId: 'read', status: RecipeExecutionStatus.Succeeded, steps: [], outputs: {}, context: {} } })
    const runner = new TestGroupRunner(new MockRunner(execute)); const first = runner.run({ group, catalogs: { 'cwt-th04s': bundle } })
    await expect(runner.run({ group, catalogs: { 'cwt-th04s': bundle } })).rejects.toThrow(/이미 실행/); resolve(); await first
  })
  it('물리 분리 오류 뒤에는 남은 node를 실행하지 않는다', async () => {
    const execute = vi.fn().mockRejectedValue(new SerialDisconnectedError('removed', SerialDisconnectReason.DeviceRemoved))
    const runner = new TestGroupRunner(new MockRunner(execute)); await runner.run({ group, catalogs: { 'cwt-th04s': bundle } })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(runner.snapshot.results.map(({ status }) => status)).toEqual(['disconnected', 'cancelled'])
  })
  it('사용자 취소 후에는 다음 node를 시작하지 않는다', async () => {
    const execute = vi.fn((_profileId: string, _recipeId: string, _parameters?: Readonly<Record<string, unknown>>, signal?: AbortSignal) => new Promise<RecipeExecutionResult>((_resolve, reject) => signal?.addEventListener('abort', () => reject(new RecipeAbortedError('read')), { once: true })))
    const runner = new TestGroupRunner(new MockRunner(execute)); const running = runner.run({ group, catalogs: { 'cwt-th04s': bundle } }); runner.cancel(); await running
    expect(execute).toHaveBeenCalledTimes(1)
    expect(runner.snapshot.results.every(({ status }) => status === 'cancelled')).toBe(true)
  })

  it('자동 측정은 node 사이에 RTU t3.5만 두고 전체 순회 뒤 선택 간격을 기다린다', async () => {
    vi.useFakeTimers()
    try {
      const execute = vi.fn().mockResolvedValue({ recipeId: 'read', status: RecipeExecutionStatus.Succeeded, steps: [], outputs: {}, context: {} })
      const runner = new TestGroupRunner(new MockRunner(execute))
      const automaticRun = runner.runAutomatically({ group, catalogs: { 'cwt-th04s': bundle } }, 1_000)
      await vi.advanceTimersByTimeAsync(0)
      expect(execute).toHaveBeenCalledTimes(1)
      expect(execute.mock.calls[0][2]).toEqual({ deviceId: 1 })

      await vi.advanceTimersByTimeAsync(3)
      expect(execute).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      expect(execute).toHaveBeenCalledTimes(2)
      expect(execute.mock.calls[1][2]).toEqual({ deviceId: 2 })

      await vi.advanceTimersByTimeAsync(999)
      expect(execute).toHaveBeenCalledTimes(2)
      await vi.advanceTimersByTimeAsync(1)
      expect(execute).toHaveBeenCalledTimes(3)
      expect(execute.mock.calls[2][2]).toEqual({ deviceId: 1 })

      runner.cancel()
      await automaticRun
      expect(runner.snapshot.mode).toBe('idle')
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('자동 측정은 한 node timeout 뒤에도 다음 node를 실행한다', async () => {
    vi.useFakeTimers()
    try {
      const execute = vi.fn().mockRejectedValueOnce(new ModbusTimeoutError('timeout')).mockResolvedValueOnce({ recipeId: 'read', status: RecipeExecutionStatus.Succeeded, steps: [], outputs: {}, context: {} })
      const runner = new TestGroupRunner(new MockRunner(execute))
      const automaticRun = runner.runAutomatically({ group, catalogs: { 'cwt-th04s': bundle } }, 1_000)
      await vi.waitFor(() => expect(runner.snapshot.results[0]?.status).toBe('timeout'))
      await vi.advanceTimersByTimeAsync(4)
      await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))
      expect(runner.snapshot.results[1]?.status).toBe('succeeded')
      runner.cancel()
      await automaticRun
    } finally {
      vi.useRealTimers()
    }
  })

  it('자동 측정은 느린 응답이 끝나기 전에 다음 요청을 시작하지 않는다', async () => {
    vi.useFakeTimers()
    try {
      let resolveFirst!: (result: RecipeExecutionResult) => void
      const firstResult = new Promise<RecipeExecutionResult>((resolve) => { resolveFirst = resolve })
      const succeeded = { recipeId: 'read', status: RecipeExecutionStatus.Succeeded, steps: [], outputs: {}, context: {} } as const
      const execute = vi.fn().mockReturnValueOnce(firstResult).mockResolvedValue(succeeded)
      const runner = new TestGroupRunner(new MockRunner(execute))
      const automaticRun = runner.runAutomatically({ group, catalogs: { 'cwt-th04s': bundle } }, 1_000)
      await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(1))

      await vi.advanceTimersByTimeAsync(10_000)
      expect(execute).toHaveBeenCalledTimes(1)
      resolveFirst(succeeded)
      await Promise.resolve()
      await vi.advanceTimersByTimeAsync(3)
      expect(execute).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(1)
      await vi.waitFor(() => expect(execute).toHaveBeenCalledTimes(2))

      runner.cancel()
      await automaticRun
    } finally {
      vi.useRealTimers()
    }
  })

  it('자동 측정은 Serial 분리 뒤 남은 node와 다음 cycle을 실행하지 않는다', async () => {
    const execute = vi.fn().mockRejectedValue(new SerialDisconnectedError('removed', SerialDisconnectReason.DeviceRemoved))
    const runner = new TestGroupRunner(new MockRunner(execute))
    await runner.runAutomatically({ group, catalogs: { 'cwt-th04s': bundle } }, 1_000)
    expect(execute).toHaveBeenCalledTimes(1)
    expect(runner.snapshot.results.map(({ status }) => status)).toEqual(['disconnected', 'cancelled'])
    expect(runner.snapshot.mode).toBe('idle')
  })
})
