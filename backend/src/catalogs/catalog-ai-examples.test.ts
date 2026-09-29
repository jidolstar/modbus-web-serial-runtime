import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import catalogBundle from '@modbus-manager/device-catalog-domain/examples/cwt-th04s.bundle.json'
import { selectCatalogAiExamples } from './catalog-ai.service'
import { CatalogValidationService } from './catalog-validation.service'
import type { CatalogAiExampleRow } from './catalog.repository'

function exampleRow(index: number): CatalogAiExampleRow {
  return {
    catalog_key: `example-${index}`,
    title: `활성 예시 ${index}`,
    definition_json: JSON.stringify(catalogBundle).replaceAll('cwt-th04s', `example-${index}`),
  }
}

describe('AI Catalog examples', () => {
  it('selects at most three currently valid CatalogBundle definitions', () => {
    const rows: CatalogAiExampleRow[] = [
      exampleRow(1), exampleRow(2), exampleRow(3), exampleRow(4),
      { catalog_key: 'invalid', title: '잘못된 과거 자료', definition_json: '{}' },
    ]

    const selected = selectCatalogAiExamples(rows, new CatalogValidationService())

    assert.equal(selected.length, 3)
    assert.deepEqual(selected.map((example) => example.catalogKey), ['example-1', 'example-2', 'example-3'])
    assert.equal(selected.every((example) => example.definition.profile.id.startsWith('example-')), true)
    assert.equal(selected.every((example) => example.definition.recipes.every((recipe) => recipe.schemaVersion === '2.0')), true)
  })

  it('does not send a server-valid legacy output back to Gemini as a new-format example', () => {
    const firstRecipe = catalogBundle.recipes[0]!
    const remainingOutputs = firstRecipe.outputs?.slice(1) ?? []
    const legacyDefinition = {
      ...catalogBundle,
      recipes: [{
        ...firstRecipe,
        outputs: [{ name: 'humidity', source: 'measurementRegisters[0]', decoder: 'uint16', scale: 0.1, unit: '%RH' }, ...remainingOutputs],
      }, ...catalogBundle.recipes.slice(1)],
    }
    const selected = selectCatalogAiExamples([{
      catalog_key: 'legacy-output',
      title: '구형 출력 예시',
      definition_json: JSON.stringify(legacyDefinition),
    }], new CatalogValidationService())

    assert.deepEqual(selected, [])
  })
})
