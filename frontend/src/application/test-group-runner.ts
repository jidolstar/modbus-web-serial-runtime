import { STANDARD_DEVICE_ID_PARAMETER } from '../device-catalog/recipe.types'
import { ModbusExceptionError, ModbusTimeoutError } from '../modbus/modbus-errors'
import { RecipeAbortedError } from '../recipe-engine/recipe-execution-errors'
import { SerialDisconnectedError } from '../serial/serial-errors'
import type { RecipeNamedOutput, RecipeRunner } from '../recipe-engine/recipe-execution.types'
import { findErrorCause } from './operation-errors'
import type { TestGroupRuntimeSnapshot } from './test-group'

export type TestGroupNodeStatus = 'waiting' | 'running' | 'succeeded' | 'timeout' | 'modbus-exception' | 'recipe-error' | 'disconnected' | 'cancelled'
export interface TestGroupNodeResult { readonly nodeId: number; readonly status: TestGroupNodeStatus; readonly outputs: Readonly<Record<string, RecipeNamedOutput>>; readonly finishedAt: Date | null; readonly message?: string }
export interface TestGroupRunSnapshot { readonly running: boolean; readonly completed: number; readonly total: number; readonly results: readonly TestGroupNodeResult[] }

/** 한 Test Bus에서 Group node의 첫 measurement를 겹치지 않게 순차 실행한다. */
export class TestGroupRunner {
  #controller: AbortController | null = null
  #snapshot: TestGroupRunSnapshot = Object.freeze({ running: false, completed: 0, total: 0, results: Object.freeze([]) })
  readonly #listeners = new Set<(snapshot: TestGroupRunSnapshot) => void>()
  public constructor(private readonly runner: RecipeRunner) {}
  public get snapshot(): TestGroupRunSnapshot { return this.#snapshot }
  public subscribe(listener: (snapshot: TestGroupRunSnapshot) => void): () => void { this.#listeners.add(listener); listener(this.#snapshot); return () => this.#listeners.delete(listener) }

  public async run(snapshot: TestGroupRuntimeSnapshot): Promise<void> {
    if (this.#controller) throw new Error('테스트 그룹 작업이 이미 실행 중입니다.')
    this.#controller = new AbortController()
    const results: TestGroupNodeResult[] = snapshot.group.nodes.map(({ id }) => Object.freeze({ nodeId: id, status: 'waiting', outputs: Object.freeze({}), finishedAt: null }))
    this.update(true, 0, results)
    try {
      for (const [index, node] of snapshot.group.nodes.entries()) {
        if (this.#controller.signal.aborted) { results[index] = Object.freeze({ ...results[index], status: 'cancelled', finishedAt: new Date() }); continue }
        results[index] = Object.freeze({ ...results[index], status: 'running' }); this.update(true, index, results)
        const bundle = snapshot.catalogs[node.catalogKey]
        const recipeId = bundle?.profile.recipes.measurements?.[0]
        if (!bundle || !recipeId) { results[index] = this.failure(node.id, 'recipe-error', '측정 Recipe가 없습니다.'); this.update(true, index + 1, results); continue }
        try {
          const execution = await this.runner.execute(bundle.profile.id, recipeId, { [STANDARD_DEVICE_ID_PARAMETER]: node.slaveId }, this.#controller.signal)
          results[index] = Object.freeze({ nodeId: node.id, status: 'succeeded', outputs: execution.outputs, finishedAt: new Date() })
        } catch (error) {
          results[index] = this.classify(node.id, error, this.#controller.signal.aborted)
        }
        this.update(true, index + 1, results)
        if (results[index].status === 'disconnected') {
          for (let remaining = index + 1; remaining < results.length; remaining += 1) results[remaining] = this.failure(snapshot.group.nodes[remaining].id, 'cancelled', 'Serial 연결이 종료되어 실행하지 않았습니다.')
          break
        }
      }
    } finally { this.#controller = null; this.update(false, results.filter(({ status }) => status !== 'waiting' && status !== 'running').length, results) }
  }
  /** node 행의 재측정·쓰기 후 확인에서 한 node만 같은 operation lock으로 실행한다. */
  public async runNode(snapshot: TestGroupRuntimeSnapshot, nodeId: number): Promise<void> {
    if (this.#controller) throw new Error('테스트 그룹 작업이 이미 실행 중입니다.')
    const node = snapshot.group.nodes.find(({ id }) => id === nodeId)
    if (!node) throw new Error('측정할 node를 찾을 수 없습니다.')
    this.#controller = new AbortController()
    const results = snapshot.group.nodes.map(({ id }) => {
      const existing = this.#snapshot.results.find(({ nodeId: existingId }) => existingId === id)
      const waiting: TestGroupNodeResult = Object.freeze({ nodeId: id, status: 'waiting', outputs: Object.freeze({}), finishedAt: null })
      return existing ?? waiting
    })
    const index = snapshot.group.nodes.findIndex(({ id }) => id === nodeId)
    results[index] = Object.freeze({ ...results[index], status: 'running' }); this.update(true, 0, results)
    try {
      const bundle = snapshot.catalogs[node.catalogKey]; const recipeId = bundle?.profile.recipes.measurements?.[0]
      if (!bundle || !recipeId) results[index] = this.failure(node.id, 'recipe-error', '측정 Recipe가 없습니다.')
      else { try { const execution = await this.runner.execute(bundle.profile.id, recipeId, { [STANDARD_DEVICE_ID_PARAMETER]: node.slaveId }, this.#controller.signal); results[index] = Object.freeze({ nodeId: node.id, status: 'succeeded', outputs: execution.outputs, finishedAt: new Date() }) } catch (error) { results[index] = this.classify(node.id, error, this.#controller.signal.aborted) } }
    } finally { this.#controller = null; this.update(false, 1, results) }
  }
  public cancel(): void { this.#controller?.abort('사용자가 Group 실행을 취소했습니다.') }
  private classify(nodeId: number, error: unknown, aborted: boolean): TestGroupNodeResult { if (aborted || error instanceof RecipeAbortedError) return this.failure(nodeId, 'cancelled', '사용자가 취소했습니다.'); if (findErrorCause(error, SerialDisconnectedError)) return this.failure(nodeId, 'disconnected', 'Serial 장치 연결이 끊어졌습니다.'); if (findErrorCause(error, ModbusTimeoutError)) return this.failure(nodeId, 'timeout', '장비 응답이 없습니다.'); if (findErrorCause(error, ModbusExceptionError)) return this.failure(nodeId, 'modbus-exception', '장비가 Modbus exception으로 응답했습니다.'); return this.failure(nodeId, 'recipe-error', 'Recipe 실행 또는 응답 해석에 실패했습니다.') }
  private failure(nodeId: number, status: TestGroupNodeStatus, message: string): TestGroupNodeResult { return Object.freeze({ nodeId, status, outputs: Object.freeze({}), finishedAt: new Date(), message }) }
  private update(running: boolean, completed: number, results: readonly TestGroupNodeResult[]): void { this.#snapshot = Object.freeze({ running, completed, total: results.length, results: Object.freeze([...results]) }); for (const listener of this.#listeners) listener(this.#snapshot) }
}
