import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CatalogError } from './catalog.error'
import { assertCatalogAiEditInstruction, assertCatalogAiSource, parseCatalogAiApproval, parseCatalogAiEditApproval, parseCatalogAiTextInput } from './catalog-ai-input'

describe('Catalog AI input parsing', () => {
  it('accepts bounded requirements and public HTTPS references', () => {
    assert.deepEqual(parseCatalogAiTextInput({ requirements: ' Example sensor ', referenceUrls: '["https://example.com/manual"]' }), {
      requirements: 'Example sensor', referenceUrls: ['https://example.com/manual'], revisionInstruction: undefined, previousProposal: undefined, sessionId: undefined,
    })
  })
  it('rejects private URLs, malformed JSON, and unexpected fields', () => {
    assert.throws(() => parseCatalogAiTextInput({ requirements: 'x', referenceUrls: '["https://127.0.0.1/manual"]' }), CatalogError)
    assert.throws(() => parseCatalogAiTextInput({ requirements: 'x', referenceUrls: 'not-json' }), CatalogError)
    assert.throws(() => parseCatalogAiTextInput({ requirements: 'x', admin: 'true' }), CatalogError)
  })
  it('allows an empty optional explanation when another source is present', () => {
    const input = parseCatalogAiTextInput({ referenceUrls: '["https://example.com/manual"]' })
    assert.equal(input.requirements, '')
    assert.doesNotThrow(() => assertCatalogAiSource(input, 0))
    assert.doesNotThrow(() => assertCatalogAiSource(parseCatalogAiTextInput({}), 1))
  })
  it('rejects a generation request without an explanation, URL, or session file', () => {
    assert.throws(() => assertCatalogAiSource(parseCatalogAiTextInput({}), 0), CatalogError)
  })
  it('keeps approval identifiers limited to the declared fields', () => {
    assert.deepEqual(parseCatalogAiApproval({ jobId: 'job', proposalDigest: 'digest', retainedFileIds: ['file'], retainedUrls: [] }), { jobId: 'job', proposalDigest: 'digest', retainedFileIds: ['file'], retainedUrls: [] })
    assert.throws(() => parseCatalogAiApproval({ jobId: 'job', proposalDigest: 'digest', retainedFileIds: [], retainedUrls: [], ownerId: 1 }), CatalogError)
  })
  it('requires a non-empty AI edit instruction and excludes the product key from approval body', () => {
    assert.throws(() => assertCatalogAiEditInstruction(parseCatalogAiTextInput({ revisionInstruction: '   ' })), CatalogError)
    assert.doesNotThrow(() => assertCatalogAiEditInstruction(parseCatalogAiTextInput({ revisionInstruction: '출력 형식을 수정해 주세요.' })))
    assert.deepEqual(parseCatalogAiEditApproval({ jobId: 'job', proposalDigest: 'digest', baseRevision: 3 }), { jobId: 'job', proposalDigest: 'digest', baseRevision: 3 })
    assert.throws(() => parseCatalogAiEditApproval({ jobId: 'job', proposalDigest: 'digest', baseRevision: 3, catalogKey: 'changed-key' }), CatalogError)
  })
})
