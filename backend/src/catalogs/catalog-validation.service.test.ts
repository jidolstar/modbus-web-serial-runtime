import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import catalogBundle = require('@modbus-manager/device-catalog-domain/examples/cwt-th04s.bundle.json')
import { CatalogError } from './catalog.error'
import { CatalogValidationService } from './catalog-validation.service'

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('CatalogValidationService', () => {
  const validator = new CatalogValidationService()

  it('accepts the shared CWT-TH04S CatalogBundle example', () => {
    assert.equal(validator.validate(catalogBundle).profile.id, 'cwt-th04s')
  })

  it('rejects a missing Recipe reference with a stable public error', () => {
    const invalidBundle = cloneJson(catalogBundle)
    invalidBundle.recipes = invalidBundle.recipes.filter(({ id }) => id !== invalidBundle.profile.recipes.measurements[0])
    assert.throws(
      () => validator.validate(invalidBundle),
      (error: unknown) => error instanceof CatalogError
        && (error.getResponse() as { code: string }).code === 'CATALOG_INVALID_INPUT',
    )
  })

  it('rejects an unsupported property instead of silently storing it', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as Record<string, unknown>
    invalidBundle.executableCode = 'return true'
    assert.throws(() => validator.validate(invalidBundle), CatalogError)
  })

  it('rejects the removed legacy probe reference', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as { profile: { recipes: Record<string, unknown> } }
    invalidBundle.profile.recipes.probe = 'legacy.probe'
    assert.throws(() => validator.validate(invalidBundle), CatalogError)
  })

  it('accepts an after-power-cycle configuration Recipe', () => {
    const validBundle = cloneJson(catalogBundle) as unknown as {
      recipes: Array<{ kind: string; applyMode?: string }>
    }
    const configurationRecipe = validBundle.recipes.find(({ kind }) => kind === 'configuration')
    assert.ok(configurationRecipe)
    configurationRecipe.applyMode = 'after-power-cycle'
    assert.equal(validator.validate(validBundle).profile.id, 'cwt-th04s')
  })

  it('rejects after-power-cycle on a measurement Recipe', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as {
      recipes: Array<{ kind: string; applyMode?: string }>
    }
    const measurementRecipe = invalidBundle.recipes.find(({ kind }) => kind === 'measurement')
    assert.ok(measurementRecipe)
    measurementRecipe.applyMode = 'after-power-cycle'
    assert.throws(() => validator.validate(invalidBundle), CatalogError)
  })
})
