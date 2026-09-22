import { describe, expect, it } from 'vitest'
import catalogIndex from '../../public/device-catalog/index.json'
import changeBaudRateRecipe from '../../public/device-catalog/cwt-th04s/change-baudrate.recipe.json'
import changeSlaveIdRecipe from '../../public/device-catalog/cwt-th04s/change-slave-id.recipe.json'
import probeRecipe from '../../public/device-catalog/cwt-th04s/probe.recipe.json'
import deviceProfile from '../../public/device-catalog/cwt-th04s/profile.json'
import measurementRecipe from '../../public/device-catalog/cwt-th04s/read-measurement.recipe.json'
import { DeviceCatalogValidationError } from './catalog-errors'
import { DeviceProfileValidator } from './device-profile-validator'

/** 테스트마다 독립적으로 변경할 수 있는 일반 JSON 복사본을 만든다. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('DeviceProfileValidator', () => {
  const validator = new DeviceProfileValidator()

  it('배포되는 CWT-TH04S Profile과 모든 Recipe를 v1 계약으로 인정한다', () => {
    expect(validator.validateCatalogIndex(catalogIndex, 'index.json').profiles).toHaveLength(1)
    expect(validator.validateDeviceProfile(deviceProfile, 'profile.json').id).toBe('cwt-th04s')

    for (const recipe of [
      probeRecipe,
      measurementRecipe,
      changeSlaveIdRecipe,
      changeBaudRateRecipe,
    ]) {
      expect(validator.validateRecipe(recipe, `${recipe.id}.json`).id).toBe(recipe.id)
    }
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
})
