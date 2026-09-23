import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CatalogError } from './catalog.error'
import { parseCatalogListQuery, parseCatalogStatusInput, parseCatalogWriteInput } from './catalog-input'

const MINIMAL_DEFINITION = { bundleVersion: '1.0', profile: {}, recipes: [] }

describe('Catalog HTTP input parsing', () => {
  it('trims a valid title and applies bounded list defaults', () => {
    assert.equal(parseCatalogWriteInput({ title: '  Example Sensor  ', definition: MINIMAL_DEFINITION }).title, 'Example Sensor')
    assert.deepEqual(parseCatalogListQuery({}), { q: undefined, enabled: undefined, limit: 20, offset: 0 })
  })

  it('rejects unexpected write fields and invalid status revisions', () => {
    assert.throws(
      () => parseCatalogWriteInput({ title: 'Example', definition: MINIMAL_DEFINITION, admin: true }),
      CatalogError,
    )
    assert.throws(() => parseCatalogStatusInput({ enabled: true, revision: 0 }), CatalogError)
  })

  it('rejects unbounded pagination and ambiguous boolean filters', () => {
    assert.throws(() => parseCatalogListQuery({ limit: '101' }), CatalogError)
    assert.throws(() => parseCatalogListQuery({ enabled: 'yes' }), CatalogError)
  })
})
