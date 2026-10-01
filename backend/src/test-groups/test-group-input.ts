import { SerialFlowControl, SerialParity, type SerialConfig } from '@modbus-manager/device-catalog-domain'
import { TestGroupError } from './test-group.error'

const MAX_NAME_LENGTH = 100
/** 한 RS485 bus에서 순차 측정할 수 있는 node의 공개 API 상한이다. */
export const MAX_TEST_GROUP_NODES = 30
const CATALOG_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/

export interface TestGroupNodeInput { readonly name: string; readonly catalogKey: string; readonly catalogRevision: number; readonly slaveId: number }
export interface TestGroupWriteInput { readonly name: string; readonly revision?: number; readonly serialConfig: SerialConfig; readonly nodes: readonly TestGroupNodeInput[] }

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function record(value: unknown): Record<string, unknown> | null { return isRecord(value) ? value : null }
function dataBits(value: unknown): 7 | 8 { if (value === 7 || value === 8) return value; throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, ['/serialConfig/dataBits']) }
function stopBits(value: unknown): 1 | 2 { if (value === 1 || value === 2) return value; throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, ['/serialConfig/stopBits']) }
function parity(value: unknown): SerialParity { if (value === SerialParity.None || value === SerialParity.Even || value === SerialParity.Odd) return value; throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, ['/serialConfig/parity']) }
function flowControl(value: unknown): SerialFlowControl { if (value === SerialFlowControl.None || value === SerialFlowControl.Hardware) return value; throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, ['/serialConfig/flowControl']) }
function exactKeys(value: Record<string, unknown>, allowed: readonly string[], path: string): void {
  if (Object.keys(value).some((key) => !allowed.includes(key))) throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, [path])
}
function name(value: unknown, path: string): string {
  const normalized = typeof value === 'string' ? value.trim() : ''
  if (!normalized || normalized.length > MAX_NAME_LENGTH) throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, [path])
  return normalized
}

/** Controller 경계에서 unknown JSON을 작고 명시적인 Group write 계약으로 변환한다. */
export function parseTestGroupInput(value: unknown, requireRevision: boolean): TestGroupWriteInput {
  const body = record(value)
  if (!body) throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, ['/'])
  exactKeys(body, requireRevision ? ['name', 'revision', 'serialConfig', 'nodes'] : ['name', 'serialConfig', 'nodes'], '/')
  const serial = record(body.serialConfig)
  if (!serial) throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, ['/serialConfig'])
  exactKeys(serial, ['baudRate', 'dataBits', 'stopBits', 'parity', 'flowControl'], '/serialConfig')
  const baudRate = serial.baudRate
  if (!Number.isInteger(baudRate) || Number(baudRate) < 300 || Number(baudRate) > 4_000_000
    || ![7, 8].includes(Number(serial.dataBits)) || ![1, 2].includes(Number(serial.stopBits))
    || !['none', 'even', 'odd'].includes(String(serial.parity)) || !['none', 'hardware'].includes(String(serial.flowControl))) {
    throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, ['/serialConfig'])
  }
  if (!Array.isArray(body.nodes) || body.nodes.length < 1 || body.nodes.length > MAX_TEST_GROUP_NODES) throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, ['/nodes'])
  const nodes = body.nodes.map((candidate, index) => {
    const node = record(candidate); const path = `/nodes/${index}`
    if (!node) throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, [path])
    exactKeys(node, ['name', 'catalogKey', 'catalogRevision', 'slaveId'], path)
    if (typeof node.catalogKey !== 'string' || !CATALOG_KEY_PATTERN.test(node.catalogKey)
      || !Number.isInteger(node.catalogRevision) || Number(node.catalogRevision) < 1
      || !Number.isInteger(node.slaveId) || Number(node.slaveId) < 1 || Number(node.slaveId) > 247) {
      throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, [path])
    }
    return Object.freeze({ name: name(node.name, `${path}/name`), catalogKey: node.catalogKey, catalogRevision: Number(node.catalogRevision), slaveId: Number(node.slaveId) })
  })
  if (new Set(nodes.map(({ slaveId }) => slaveId)).size !== nodes.length) throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, ['/nodes/slaveId'])
  const revision = body.revision
  if (requireRevision && (!Number.isInteger(revision) || Number(revision) < 1)) throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, ['/revision'])
  return Object.freeze({ name: name(body.name, '/name'), revision: requireRevision ? Number(revision) : undefined, serialConfig: Object.freeze({ baudRate: Number(baudRate), dataBits: dataBits(serial.dataBits), stopBits: stopBits(serial.stopBits), parity: parity(serial.parity), flowControl: flowControl(serial.flowControl) }), nodes: Object.freeze(nodes) })
}

export function parsePositiveId(value: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, ['id'])
  return id
}
