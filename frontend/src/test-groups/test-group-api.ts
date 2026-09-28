import { SerialFlowControl, SerialParity, type CatalogBundle } from '@modbus-manager/device-catalog-domain'
import { parseApiBaseUrl } from '../http/api-base-url'
import { DeviceProfileValidator } from '../device-catalog/device-profile-validator'
import type { TestGroup, TestGroupInput, TestGroupRuntimeSnapshot } from '../application/test-group'
export type { TestGroup, TestGroupInput, TestGroupNode, TestGroupNodeInput, TestGroupRuntimeSnapshot } from '../application/test-group'

export class TestGroupApiError extends Error { public constructor(readonly status: number, readonly code = 'REQUEST_FAILED', readonly fields: readonly string[] = []) { super('테스트 그룹 요청을 처리하지 못했습니다.') } }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }

/** Test Group 화면의 cookie 인증 CRUD와 runtime snapshot 응답을 검증한다. */
export class TestGroupApiClient {
  readonly #base: URL
  public constructor(rawBase: string | undefined, private readonly request: typeof fetch = (input, init) => fetch(input, init)) { this.#base = parseApiBaseUrl(rawBase) }

  public async list(): Promise<readonly TestGroup[]> { const value = await this.json('test-groups'); if (!Array.isArray(value)) throw new TestGroupApiError(502, 'INVALID_RESPONSE'); return value.map(parseGroup) }
  public async get(id: number): Promise<TestGroup> { return parseGroup(await this.json(`test-groups/${id}`)) }
  public async create(input: TestGroupInput): Promise<TestGroup> { return parseGroup(await this.json('test-groups', { method: 'POST', body: JSON.stringify(input) })) }
  public async update(group: TestGroup, input: TestGroupInput): Promise<TestGroup> { return parseGroup(await this.json(`test-groups/${group.id}`, { method: 'PUT', body: JSON.stringify({ ...input, revision: group.revision }) })) }
  public async delete(id: number): Promise<void> { await this.json(`test-groups/${id}`, { method: 'DELETE' }, false) }
  public async runtime(id: number): Promise<TestGroupRuntimeSnapshot> { const value = await this.json(`test-groups/${id}/runtime-snapshot`, { method: 'POST', body: '{}' }); if (!isRecord(value) || !isRecord(value.catalogs)) throw new TestGroupApiError(502, 'INVALID_RESPONSE'); const validator = new DeviceProfileValidator(); const catalogs: Record<string, CatalogBundle> = {}; for (const [key, definition] of Object.entries(value.catalogs)) catalogs[key] = validator.validateCatalogBundle(definition, `catalogs/${key}`); return Object.freeze({ group: parseGroup(value.group), catalogs: Object.freeze(catalogs) }) }

  async json(path: string, init: RequestInit = {}, expectBody = true): Promise<unknown> {
    const response = await this.request(new URL(path, this.#base), { ...init, credentials: 'include', headers: { Accept: 'application/json', ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...init.headers } }).catch(() => { throw new TestGroupApiError(0, 'NETWORK_ERROR') })
    if (!response.ok) { const candidate: unknown = await response.json().catch(() => null); const body = isRecord(candidate) ? candidate : {}; throw new TestGroupApiError(response.status, typeof body.code === 'string' ? body.code : 'REQUEST_FAILED', Array.isArray(body.fields) ? body.fields.filter((item): item is string => typeof item === 'string').slice(0, 20) : []) }
    return expectBody && response.status !== 204 ? response.json() : undefined
  }
}

function parseGroup(value: unknown): TestGroup {
  if (!isRecord(value) || !Number.isInteger(value.id) || typeof value.name !== 'string' || !Number.isInteger(value.revision) || !isRecord(value.serialConfig) || !Array.isArray(value.nodes) || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') throw new TestGroupApiError(502, 'INVALID_RESPONSE')
  const serial = value.serialConfig
  if (!Number.isInteger(serial.baudRate) || ![7, 8].includes(Number(serial.dataBits)) || ![1, 2].includes(Number(serial.stopBits)) || !['none', 'even', 'odd'].includes(String(serial.parity)) || !['none', 'hardware'].includes(String(serial.flowControl))) throw new TestGroupApiError(502, 'INVALID_RESPONSE')
  const nodes = value.nodes.map((item) => { if (!isRecord(item) || !Number.isInteger(item.id) || typeof item.name !== 'string' || typeof item.catalogKey !== 'string' || !Number.isInteger(item.catalogRevision) || !Number.isInteger(item.slaveId) || !Number.isInteger(item.position)) throw new TestGroupApiError(502, 'INVALID_RESPONSE'); return Object.freeze({ id: Number(item.id), name: item.name, catalogKey: item.catalogKey, catalogRevision: Number(item.catalogRevision), slaveId: Number(item.slaveId), position: Number(item.position) }) })
  const dataBits: 7 | 8 = serial.dataBits === 7 ? 7 : 8
  const stopBits: 1 | 2 = serial.stopBits === 2 ? 2 : 1
  const parity = serial.parity === SerialParity.Even ? SerialParity.Even : serial.parity === SerialParity.Odd ? SerialParity.Odd : SerialParity.None
  const flowControl = serial.flowControl === SerialFlowControl.Hardware ? SerialFlowControl.Hardware : SerialFlowControl.None
  return Object.freeze({ id: Number(value.id), name: value.name, revision: Number(value.revision), serialConfig: Object.freeze({ baudRate: Number(serial.baudRate), dataBits, stopBits, parity, flowControl }), nodes: Object.freeze(nodes), createdAt: value.createdAt, updatedAt: value.updatedAt })
}

export const testGroupApi = new TestGroupApiClient(import.meta.env.VITE_API_BASE_URL)
