import { describe, expect, it } from 'vitest'
import bundle from '@modbus-manager/device-catalog-domain/examples/cwt-th04s.bundle.json'
import { DeviceProfileValidator } from '../../device-catalog/device-profile-validator'
import { summarizeCatalogRecipes } from './catalog-recipe-summary'

describe('summarizeCatalogRecipes', () => {
  it('Profile 역할과 Recipe Step에서 측정·읽기·쓰기 정보를 함께 만든다', () => {
    const validatedBundle = new DeviceProfileValidator().validateCatalogBundle(bundle, 'cwt-th04s.bundle.json')
    const summaries = summarizeCatalogRecipes(validatedBundle)
    const measurement = summaries.find(({ id }) => id === validatedBundle.profile.recipes.measurements?.[0])
    const slaveChange = summaries.find(({ id }) => id === validatedBundle.profile.recipes.changeSlaveId)

    expect(measurement).toMatchObject({ roles: ['주기 측정'], operations: ['읽기 FC03'], supported: true })
    expect(measurement?.results).toContain('humidity · number · %RH')
    expect(slaveChange).toMatchObject({ roles: ['Slave ID 변경'], operations: ['쓰기 FC06'], results: [] })
  })
})
