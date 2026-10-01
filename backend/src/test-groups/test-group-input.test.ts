import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { TestGroupError } from './test-group.error'
import { parseTestGroupInput } from './test-group-input'

const VALID = { name: ' 시험실 A ', serialConfig: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }, nodes: [{ name: ' 센서 1 ', catalogKey: 'example-sensor', catalogRevision: 1, slaveId: 1 }] }
describe('parseTestGroupInput', () => {
  it('공개 필드만 정규화한다', () => { const parsed = parseTestGroupInput(VALID, false); assert.equal(parsed.name, '시험실 A'); assert.equal(parsed.nodes[0].name, '센서 1') })
  it('중복 Slave ID와 예상하지 않은 필드를 거부한다', () => { assert.throws(() => parseTestGroupInput({ ...VALID, nodes: [...VALID.nodes, { ...VALID.nodes[0], name: '센서 2' }] }, false), TestGroupError); assert.throws(() => parseTestGroupInput({ ...VALID, ownerUserId: 99 }, false), TestGroupError) })
  it('수정 요청에는 revision을 요구한다', () => { assert.throws(() => parseTestGroupInput(VALID, true), TestGroupError) })
  it('node는 최대 30개까지 허용하고 31개는 거부한다', () => {
    const nodes = Array.from({ length: 31 }, (_, index) => ({ ...VALID.nodes[0], name: `센서 ${index + 1}`, slaveId: index + 1 }))
    assert.equal(parseTestGroupInput({ ...VALID, nodes: nodes.slice(0, 30) }, false).nodes.length, 30)
    assert.throws(() => parseTestGroupInput({ ...VALID, nodes }, false), (error) => {
      if (!(error instanceof TestGroupError)) return false
      const response = error.getResponse()
      return typeof response === 'object' && response !== null && 'fields' in response && Array.isArray(response.fields) && response.fields.includes('/nodes')
    })
  })
})
