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

  it('explains a changeBaudRate enum that differs from supported baud rates', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as {
      profile: { serial: { supportedBaudRates: number[] }; recipes: { changeBaudRate: string } }
      recipes: Array<{ id: string; parameters?: Array<{ name: string; values?: Array<string | number> }> }>
    }
    const baudRecipe = invalidBundle.recipes.find(({ id }) => id === invalidBundle.profile.recipes.changeBaudRate)
    const targetBaud = baudRecipe?.parameters?.find(({ name }) => name === 'targetBaud')
    assert.ok(targetBaud?.values)
    targetBaud.values = targetBaud.values.slice(0, -1)

    assert.deepEqual(validator.inspect(invalidBundle), [{
      path: '/profile/recipes/changeBaudRate',
      message: `changeBaudRate Recipe의 targetBaud enum은 supportedBaudRates와 순서까지 같아야 합니다: ${invalidBundle.profile.serial.supportedBaudRates.join(', ')}`,
    }])
  })

  it('explains enum values that are missing from a write Step map', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as {
      profile: { maps: Record<string, Record<string, number>>; recipes: { changeBaudRate: string } }
      recipes: Array<{ id: string }>
    }
    delete invalidBundle.profile.maps['baud-rate']['9600']
    const baudRecipeIndex = invalidBundle.recipes.findIndex(({ id }) => id === invalidBundle.profile.recipes.changeBaudRate)

    assert.ok(validator.inspect(invalidBundle).some((issue) => (
      issue.path === `/recipes/${baudRecipeIndex}/steps/0/value/map`
      && issue.message.includes("map 'baud-rate'")
      && issue.message.includes('9600')
    )))
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

  it('decoder가 요구하는 register count와 다른 v2 output을 거부한다', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as { recipes: Array<{ outputs?: Array<{ source: { count: number } }> }> }
    invalidBundle.recipes[0].outputs![0].source.count = 2
    assert.throws(() => validator.validate(invalidBundle), CatalogError)
  })

  it('문자열 decoder에 숫자 transform을 선언한 v2 output을 거부한다', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as { recipes: Array<{ outputs?: Array<Record<string, unknown>> }> }
    invalidBundle.recipes[0].outputs![0].decode = { type: 'ascii' }
    invalidBundle.recipes[0].outputs![0].format = { type: 'text' }
    assert.throws(() => validator.validate(invalidBundle), CatalogError)
  })

  it('output이 있는 읽기 전용 measurement Recipe를 추가 작업 allowlist로 저장할 수 있다', () => {
    const validBundle = cloneJson(catalogBundle) as unknown as { profile: { recipes: { actions: string[]; measurements: string[] } } }
    validBundle.profile.recipes.actions = [validBundle.profile.recipes.measurements[0]]
    assert.equal(validator.validate(validBundle).profile.recipes.actions?.length, 1)
  })

  it('write configuration Recipe를 추가 작업 allowlist로 저장할 수 있다', () => {
    const validBundle = cloneJson(catalogBundle) as unknown as { profile: { recipes: { actions: string[]; changeSlaveId: string } }; recipes: Array<{ id: string }> }
    const source = validBundle.recipes.find(({ id }) => id === validBundle.profile.recipes.changeSlaveId)!
    const action = { ...source, id: 'cwt-th04s.write-safe-setting' }
    validBundle.recipes.push(action)
    validBundle.profile.recipes.actions = [action.id]
    assert.equal(validator.validate(validBundle).profile.recipes.actions?.length, 1)
  })

  it('표준 통신 설정 Recipe를 추가 작업으로 중복 공개하면 거부한다', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as { profile: { recipes: { actions: string[]; changeSlaveId: string } } }
    invalidBundle.profile.recipes.actions = [invalidBundle.profile.recipes.changeSlaveId]
    assert.throws(() => validator.validate(invalidBundle), CatalogError)
  })

  it('표준 설정 변경 Recipe 안의 자동 읽기 검증을 거부한다', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as { profile: { recipes: { changeSlaveId: string } }; recipes: Array<{ id: string; steps: Array<Record<string, unknown>> }> }
    const recipe = invalidBundle.recipes.find(({ id }) => id === invalidBundle.profile.recipes.changeSlaveId)
    recipe?.steps.push({ id: 'automatic-verification', type: 'readHoldingRegisters', slaveId: '${targetId}', address: 0, count: 1, saveAs: 'registers' })
    assert.throws(() => validator.validate(invalidBundle), CatalogError)
  })
})
