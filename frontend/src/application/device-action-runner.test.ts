import { describe, expect, it, vi } from 'vitest'
import { DeviceProfileSchemaVersion, type DeviceProfile } from '../device-catalog/device-profile.types'
import { RecipeErrorPolicy, RecipeKind, RecipeSchemaVersion, RecipeStepType, type Recipe } from '../device-catalog/recipe.types'
import { SerialFlowControl, SerialParity } from '../serial/serial-types'
import type { DeviceCatalog } from '../device-catalog/catalog.types'
import type { RecipeRunner } from '../recipe-engine/recipe-execution.types'
import { DeviceActionRunner } from './device-action-runner'

const ACTION: Recipe = {
  schemaVersion: RecipeSchemaVersion.Version1, id: 'device.reset-alarm', name: '알람 초기화',
  kind: RecipeKind.Configuration, parameters: [{ name: 'deviceId', type: 'integer', minimum: 1, maximum: 247 }, { name: 'resetCode', type: 'enum', values: [1] }],
  steps: [{ id: 'write', type: RecipeStepType.WriteSingleRegister, slaveId: 'deviceId', address: 20, value: 'resetCode' }], onError: RecipeErrorPolicy.Stop,
}
const PROFILE: DeviceProfile = {
  schemaVersion: DeviceProfileSchemaVersion.Version1, id: 'device', manufacturer: 'Example', model: 'Device',
  serial: { default: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: SerialParity.None, flowControl: SerialFlowControl.None }, supportedBaudRates: [9600] },
  slave: { defaultId: 1, minId: 1, maxId: 247 }, recipes: { actions: [ACTION.id] },
}
const catalog: DeviceCatalog = {
  load: async () => undefined, getProfile: () => PROFILE, getRecipe: () => ACTION,
  listProfiles: () => [{ id: PROFILE.id, manufacturer: PROFILE.manufacturer, model: PROFILE.model }],
}

describe('DeviceActionRunner', () => {
  it('allowlist 작업에 현재 Slave ID를 주입한다', async () => {
    const execute = vi.fn().mockResolvedValue({ outputs: {} })
    await new DeviceActionRunner(catalog, { execute } as RecipeRunner).execute('device', ACTION.id, 7, { resetCode: 1 })
    expect(execute).toHaveBeenCalledWith('device', ACTION.id, { deviceId: 7, resetCode: 1 }, undefined)
  })

  it('Profile에 공개되지 않은 Recipe를 통신 전에 거부한다', async () => {
    const execute = vi.fn()
    await expect(new DeviceActionRunner(catalog, { execute } as RecipeRunner).execute('device', 'hidden', 7, {})).rejects.toThrow(/허용하지 않는/)
    expect(execute).not.toHaveBeenCalled()
  })
})
