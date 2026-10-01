import { describe, expect, it } from 'vitest'
import catalogBundle from '@modbus-manager/device-catalog-domain/examples/cwt-th04s.bundle.json'
import catalogIndex from '../test-fixtures/device-catalog/index.json'
import changeBaudRateRecipe from '../test-fixtures/device-catalog/cwt-th04s/change-baudrate.recipe.json'
import changeSlaveIdRecipe from '../test-fixtures/device-catalog/cwt-th04s/change-slave-id.recipe.json'
import deviceProfile from '../test-fixtures/device-catalog/cwt-th04s/profile.json'
import measurementRecipe from '../test-fixtures/device-catalog/cwt-th04s/read-measurement.recipe.json'
import { DeviceCatalogValidationError } from './catalog-errors'
import { DeviceProfileValidator } from './device-profile-validator'

/** 테스트마다 독립적으로 변경할 수 있는 일반 JSON 복사본을 만든다. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('DeviceProfileValidator', () => {
  const validator = new DeviceProfileValidator()

  it('배포되는 CWT-TH04S Profile과 모든 Recipe를 v1 계약으로 인정한다', () => {
    expect(validator.validateCatalogBundle(catalogBundle, 'cwt-th04s.bundle.json').profile.id)
      .toBe('cwt-th04s')
    expect(validator.validateCatalogIndex(catalogIndex, 'index.json').profiles).toHaveLength(1)
    expect(validator.validateDeviceProfile(deviceProfile, 'profile.json').id).toBe('cwt-th04s')

    for (const recipe of [
      measurementRecipe,
      changeSlaveIdRecipe,
      changeBaudRateRecipe,
    ]) {
      expect(validator.validateRecipe(recipe, `${recipe.id}.json`).id).toBe(recipe.id)
    }
  })

  it('Bundle의 누락된 Recipe 참조를 저장 전에 거부한다', () => {
    const invalidBundle = cloneJson(catalogBundle)
    invalidBundle.recipes = invalidBundle.recipes.filter(
      (recipe) => recipe.id !== invalidBundle.profile.recipes.measurements[0],
    )

    expect(() => validator.validateCatalogBundle(invalidBundle, 'broken.bundle.json'))
      .toThrowError(/존재하지 않는 Recipe를 참조합니다/)
  })

  it('지원하지 않는 기본 baudrate를 정확한 JSON 경로와 함께 거부한다', () => {
    const invalidProfile = cloneJson(deviceProfile)
    invalidProfile.serial.default.baudRate = 19200

    expect(() => validator.validateDeviceProfile(invalidProfile, 'broken-profile.json'))
      .toThrowError(new DeviceCatalogValidationError(
        'broken-profile.json/serial/default/baudRate: supportedBaudRates에 포함되어야 합니다.',
      ))
  })

  it('Recipe에 정의되지 않은 Step이 들어오면 파일과 Step 경로를 알려준다', () => {
    const invalidRecipe = cloneJson(measurementRecipe) as unknown as {
      steps: Array<Record<string, unknown>>
    }
    invalidRecipe.steps[0].type = 'readInputRegisters'

    expect(() => validator.validateRecipe(invalidRecipe, 'unsupported-step.recipe.json'))
      .toThrowError(/unsupported-step\.recipe\.json\/steps\/0/)
  })

  it('제거된 probe 참조가 포함된 legacy Profile을 거부한다', () => {
    const legacyProfile = cloneJson(deviceProfile) as unknown as Record<string, unknown>
    ;(legacyProfile.recipes as Record<string, unknown>).probe = 'legacy.probe'
    expect(() => validator.validateDeviceProfile(legacyProfile, 'legacy-profile.json')).toThrowError(/additional properties/)
  })

  it('output이 있는 읽기 전용 measurement Recipe를 추가 작업으로 공개할 수 있다', () => {
    const validBundle = cloneJson(catalogBundle) as unknown as { profile: { recipes: { actions: string[]; measurements: string[] } } }
    validBundle.profile.recipes.actions = [validBundle.profile.recipes.measurements[0]]
    expect(validator.validateCatalogBundle(validBundle, 'read-action.bundle.json').profile.recipes.actions).toHaveLength(1)
  })

  it('write가 포함된 configuration Recipe는 추가 작업으로 공개할 수 있다', () => {
    const validBundle = cloneJson(catalogBundle) as unknown as { profile: { recipes: { actions: string[]; changeSlaveId: string } }; recipes: Array<{ id: string }> }
    const source = validBundle.recipes.find(({ id }) => id === validBundle.profile.recipes.changeSlaveId)!
    const action = { ...source, id: 'cwt-th04s.write-safe-setting' }
    validBundle.recipes.push(action)
    validBundle.profile.recipes.actions = [action.id]
    expect(validator.validateCatalogBundle(validBundle, 'action.bundle.json').profile.recipes.actions).toHaveLength(1)
  })

  it('표준 통신 설정 Recipe를 추가 작업으로 중복 공개하면 거부한다', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as { profile: { recipes: { actions: string[]; changeSlaveId: string } } }
    invalidBundle.profile.recipes.actions = [invalidBundle.profile.recipes.changeSlaveId]
    expect(() => validator.validateCatalogBundle(invalidBundle, 'duplicate-action.bundle.json')).toThrow(/중복 공개/)
  })

  it('output이 없는 measurement Recipe를 조회 추가 작업으로 공개하면 거부한다', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as { profile: { recipes: { actions: string[]; measurements: string[] } }; recipes: Array<{ id: string; outputs?: unknown[] }> }
    const actionId = invalidBundle.profile.recipes.measurements[0]
    invalidBundle.recipes.find(({ id }) => id === actionId)!.outputs = []
    invalidBundle.profile.recipes.actions = [actionId]
    expect(() => validator.validateCatalogBundle(invalidBundle, 'empty-read-action.bundle.json')).toThrow(/읽기 Step과 output/)
  })

  it('추가 작업 안에서 Serial 연결을 다시 열면 거부한다', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as { profile: { recipes: { actions: string[]; measurements: string[] } }; recipes: Array<{ id: string; steps: Array<Record<string, unknown>> }> }
    const actionId = invalidBundle.profile.recipes.measurements[0]
    invalidBundle.recipes.find(({ id }) => id === actionId)?.steps.push({ id: 'reopen', type: 'reopenSerial', baudRate: 9600 })
    invalidBundle.profile.recipes.actions = [actionId]
    expect(() => validator.validateCatalogBundle(invalidBundle, 'reopen-action.bundle.json')).toThrow(/Serial 연결을 다시 열 수 없습니다/)
  })

  it('표준 설정 변경 Recipe가 재접속이나 읽기 검증을 포함하면 거부한다', () => {
    const invalidBundle = cloneJson(catalogBundle) as unknown as { profile: { recipes: { changeBaudRate: string } }; recipes: Array<{ id: string; steps: Array<Record<string, unknown>> }> }
    const recipe = invalidBundle.recipes.find(({ id }) => id === invalidBundle.profile.recipes.changeBaudRate)
    recipe?.steps.push({ id: 'automatic-reopen', type: 'reopenSerial', baudRate: '${targetBaud}' })

    expect(() => validator.validateCatalogBundle(invalidBundle, 'automatic-reconnect.bundle.json'))
      .toThrow(/쓰기 후 연결·검증 Step을 포함할 수 없습니다/)
  })
})
