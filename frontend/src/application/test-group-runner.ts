import { STANDARD_DEVICE_ID_PARAMETER } from '../device-catalog/recipe.types'
import { ModbusExceptionError, ModbusTimeoutError } from '../modbus/modbus-errors'
import { modbusRtuInterFrameDelayMs } from '../modbus/rtu-timing'
import { RecipeAbortedError } from '../recipe-engine/recipe-execution-errors'
import type { RecipeNamedOutput, RecipeRunner } from '../recipe-engine/recipe-execution.types'
import { SerialDisconnectedError } from '../serial/serial-errors'
import { findErrorCause } from './operation-errors'
import type { TestGroupNode, TestGroupRuntimeSnapshot } from './test-group'

export const TEST_GROUP_AUTO_INTERVALS_MS = Object.freeze([1_000, 3_000, 5_000, 10_000, 30_000, 60_000] as const)
export type TestGroupAutoIntervalMs = typeof TEST_GROUP_AUTO_INTERVALS_MS[number]
export type TestGroupRunMode = 'idle' | 'manual-all' | 'manual-node' | 'automatic' | 'stopping'
export type TestGroupNodeStatus = 'waiting' | 'running' | 'succeeded' | 'timeout' | 'modbus-exception' | 'recipe-error' | 'disconnected' | 'cancelled'

export interface TestGroupNodeResult {
  readonly nodeId: number
  readonly status: TestGroupNodeStatus
  readonly outputs: Readonly<Record<string, RecipeNamedOutput>>
  readonly startedAt: Date | null
  readonly finishedAt: Date | null
  readonly cycle: number | null
  readonly message?: string
}

export interface TestGroupRunSnapshot {
  readonly mode: TestGroupRunMode
  readonly running: boolean
  readonly completed: number
  readonly total: number
  readonly cycle: number
  readonly currentNodeId: number | null
  readonly nextRunAt: Date | null
  readonly results: readonly TestGroupNodeResult[]
}

const EMPTY_SNAPSHOT: TestGroupRunSnapshot = Object.freeze({ mode: 'idle', running: false, completed: 0, total: 0, cycle: 0, currentNodeId: null, nextRunAt: null, results: Object.freeze([]) })

/**
 * TestGroupRunView의 수동·자동 측정을 하나의 operation lock으로 순차 실행한다.
 * node 실패는 결과로 격리하지만 Serial 연결 자체가 끊기면 남은 요청과 대기 timer를 모두 종료한다.
 */
export class TestGroupRunner {
  #controller: AbortController | null = null
  #snapshot: TestGroupRunSnapshot = EMPTY_SNAPSHOT
  readonly #listeners = new Set<(snapshot: TestGroupRunSnapshot) => void>()

  public constructor(private readonly runner: RecipeRunner) {}
  public get snapshot(): TestGroupRunSnapshot { return this.#snapshot }
  public subscribe(listener: (snapshot: TestGroupRunSnapshot) => void): () => void { this.#listeners.add(listener); listener(this.#snapshot); return () => this.#listeners.delete(listener) }

  /** 새 Serial 연결이 시작될 때 이전 연결의 성공값이 현재 장비 검증으로 사용되지 않도록 비운다. */
  public reset(): void {
    if (this.#controller) throw new Error('실행 중인 테스트 그룹은 초기화할 수 없습니다.')
    this.publish(EMPTY_SNAPSHOT)
  }

  /** 사용자가 누른 전체 측정에서 모든 node를 한 번만 실행한다. */
  public async run(snapshot: TestGroupRuntimeSnapshot): Promise<void> {
    const controller = this.beginOperation()
    const results = this.waitingResults(snapshot)
    this.update('manual-all', 0, results.length, 1, null, null, results)
    try {
      for (const [index, node] of snapshot.group.nodes.entries()) {
        if (controller.signal.aborted) { results[index] = this.failure(node.id, 'cancelled', '사용자가 취소했습니다.', 1); continue }
        results[index] = await this.executeNode(snapshot, node, results[index], controller.signal, 1)
        this.update('manual-all', index + 1, results.length, 1, null, null, results)
        if (results[index].status === 'disconnected') { this.cancelRemaining(snapshot, results, index + 1, 1); break }
        if (index < snapshot.group.nodes.length - 1 && !await this.wait(modbusRtuInterFrameDelayMs(snapshot.group.serialConfig), controller.signal)) {
          this.cancelRemaining(snapshot, results, index + 1, 1)
          break
        }
      }
    } finally {
      this.finishOperation(results, 1)
    }
  }

  /** node 행의 재측정과 쓰기 후 확인에서 한 node만 같은 operation lock으로 실행한다. */
  public async runNode(snapshot: TestGroupRuntimeSnapshot, nodeId: number): Promise<void> {
    const node = snapshot.group.nodes.find(({ id }) => id === nodeId)
    if (!node) throw new Error('측정할 node를 찾을 수 없습니다.')
    const controller = this.beginOperation()
    const results = this.resultsWithWaitingNodes(snapshot)
    const index = snapshot.group.nodes.findIndex(({ id }) => id === nodeId)
    this.update('manual-node', 0, results.length, 1, node.id, null, results)
    try {
      results[index] = await this.executeNode(snapshot, node, results[index], controller.signal, 1)
      this.update('manual-node', 1, results.length, 1, null, null, results)
    } finally {
      this.finishOperation(results, 1)
    }
  }

  /**
   * 자동 측정 시작 버튼에서 호출해 node 완료와 다음 요청 사이에 선택한 간격을 둔다.
   * setInterval을 사용하지 않으므로 느린 응답과 timeout이 있어도 Modbus 요청이 서로 겹치지 않는다.
   */
  public async runAutomatically(snapshot: TestGroupRuntimeSnapshot, intervalMs: TestGroupAutoIntervalMs): Promise<void> {
    if (!TEST_GROUP_AUTO_INTERVALS_MS.includes(intervalMs)) throw new Error('지원하지 않는 자동 측정 간격입니다.')
    const controller = this.beginOperation()
    const results = this.waitingResults(snapshot)
    let cycle = 1
    let completed = 0
    const interFrameDelayMs = modbusRtuInterFrameDelayMs(snapshot.group.serialConfig)
    this.update('automatic', completed, results.length, cycle, null, null, results)
    try {
      while (!controller.signal.aborted) {
        for (const [index, node] of snapshot.group.nodes.entries()) {
          if (controller.signal.aborted) break
          results[index] = await this.executeNode(snapshot, node, results[index], controller.signal, cycle)
          completed = index + 1
          this.update('automatic', completed, results.length, cycle, null, null, results)
          if (results[index].status === 'disconnected') { this.cancelRemaining(snapshot, results, index + 1, cycle); return }
          if (index < snapshot.group.nodes.length - 1 && !await this.wait(interFrameDelayMs, controller.signal)) break
        }
        if (!controller.signal.aborted) {
          const nextRunAt = new Date(Date.now() + intervalMs)
          this.update('automatic', completed, results.length, cycle, null, nextRunAt, results)
          if (!await this.wait(intervalMs, controller.signal)) break
          cycle += 1
          completed = 0
          this.update('automatic', completed, results.length, cycle, null, null, results)
        }
      }
    } finally {
      this.finishOperation(results, cycle)
    }
  }

  /** 자동·수동 실행과 다음 요청 대기를 같은 AbortSignal로 중지한다. */
  public cancel(): void {
    if (!this.#controller) return
    this.update('stopping', this.#snapshot.completed, this.#snapshot.total, this.#snapshot.cycle, this.#snapshot.currentNodeId, null, this.#snapshot.results)
    this.#controller.abort('사용자가 Group 실행을 취소했습니다.')
  }

  private beginOperation(): AbortController {
    if (this.#controller) throw new Error('테스트 그룹 작업이 이미 실행 중입니다.')
    this.#controller = new AbortController()
    return this.#controller
  }

  private async executeNode(snapshot: TestGroupRuntimeSnapshot, node: TestGroupNode, previous: TestGroupNodeResult, signal: AbortSignal, cycle: number): Promise<TestGroupNodeResult> {
    const startedAt = new Date()
    const running = Object.freeze({ ...previous, status: 'running' as const, startedAt, finishedAt: null, cycle, message: undefined })
    this.update(this.#snapshot.mode, this.#snapshot.completed, this.#snapshot.total, cycle, node.id, null, this.replaceResult(this.#snapshot.results, running))
    const bundle = snapshot.catalogs[node.catalogKey]
    const recipeId = bundle?.profile.recipes.measurements?.[0]
    if (!bundle || !recipeId) return this.failure(node.id, 'recipe-error', '측정 Recipe가 없습니다.', cycle, startedAt)
    try {
      const execution = await this.runner.execute(bundle.profile.id, recipeId, { [STANDARD_DEVICE_ID_PARAMETER]: node.slaveId }, signal)
      return Object.freeze({ nodeId: node.id, status: 'succeeded', outputs: execution.outputs, startedAt, finishedAt: new Date(), cycle })
    } catch (error) {
      return this.classify(node.id, error, signal.aborted, cycle, startedAt)
    }
  }

  private classify(nodeId: number, error: unknown, aborted: boolean, cycle: number, startedAt: Date): TestGroupNodeResult {
    if (aborted || error instanceof RecipeAbortedError) return this.failure(nodeId, 'cancelled', '사용자가 취소했습니다.', cycle, startedAt)
    if (findErrorCause(error, SerialDisconnectedError)) return this.failure(nodeId, 'disconnected', 'Serial 장치 연결이 끊어졌습니다.', cycle, startedAt)
    if (findErrorCause(error, ModbusTimeoutError)) return this.failure(nodeId, 'timeout', '제한 시간 안에 장비 응답이 없습니다. 다른 node 측정은 계속합니다.', cycle, startedAt)
    if (findErrorCause(error, ModbusExceptionError)) return this.failure(nodeId, 'modbus-exception', '장비가 Modbus exception으로 응답했습니다. 다른 node 측정은 계속합니다.', cycle, startedAt)
    return this.failure(nodeId, 'recipe-error', '응답을 해석하거나 측정값을 읽지 못했습니다. 다른 node 측정은 계속합니다.', cycle, startedAt)
  }

  private failure(nodeId: number, status: TestGroupNodeStatus, message: string, cycle: number, startedAt: Date = new Date()): TestGroupNodeResult {
    return Object.freeze({ nodeId, status, outputs: Object.freeze({}), startedAt, finishedAt: new Date(), cycle, message })
  }
  private waitingResults(snapshot: TestGroupRuntimeSnapshot): TestGroupNodeResult[] { return snapshot.group.nodes.map(({ id }) => this.waitingResult(id)) }
  private resultsWithWaitingNodes(snapshot: TestGroupRuntimeSnapshot): TestGroupNodeResult[] { return snapshot.group.nodes.map(({ id }) => this.#snapshot.results.find(({ nodeId }) => nodeId === id) ?? this.waitingResult(id)) }
  private waitingResult(nodeId: number): TestGroupNodeResult { return Object.freeze({ nodeId, status: 'waiting', outputs: Object.freeze({}), startedAt: null, finishedAt: null, cycle: null }) }
  private replaceResult(results: readonly TestGroupNodeResult[], replacement: TestGroupNodeResult): TestGroupNodeResult[] { return results.map((result) => result.nodeId === replacement.nodeId ? replacement : result) }

  private cancelRemaining(snapshot: TestGroupRuntimeSnapshot, results: TestGroupNodeResult[], startIndex: number, cycle: number): void {
    for (let index = startIndex; index < results.length; index += 1) results[index] = this.failure(snapshot.group.nodes[index].id, 'cancelled', 'Serial 연결이 종료되어 실행하지 않았습니다.', cycle)
  }

  /** AbortSignal을 timer와 연결해 자동 중지·연결 해제 시 다음 node가 시작되지 않게 한다. */
  private wait(intervalMs: number, signal: AbortSignal): Promise<boolean> {
    return new Promise((resolve) => {
      if (signal.aborted) { resolve(false); return }
      const abort = (): void => { globalThis.clearTimeout(timeoutId); resolve(false) }
      const timeoutId = globalThis.setTimeout(() => { signal.removeEventListener('abort', abort); resolve(true) }, intervalMs)
      signal.addEventListener('abort', abort, { once: true })
    })
  }

  private finishOperation(results: readonly TestGroupNodeResult[], cycle: number): void {
    this.#controller = null
    const completed = results.filter(({ status }) => status !== 'waiting' && status !== 'running').length
    this.update('idle', completed, results.length, cycle, null, null, results)
  }
  private update(mode: TestGroupRunMode, completed: number, total: number, cycle: number, currentNodeId: number | null, nextRunAt: Date | null, results: readonly TestGroupNodeResult[]): void { this.publish(Object.freeze({ mode, running: mode !== 'idle', completed, total, cycle, currentNodeId, nextRunAt, results: Object.freeze([...results]) })) }
  private publish(snapshot: TestGroupRunSnapshot): void { this.#snapshot = snapshot; for (const listener of this.#listeners) listener(snapshot) }
}
