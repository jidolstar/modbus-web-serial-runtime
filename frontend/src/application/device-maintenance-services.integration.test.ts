import { describe, expect, it } from 'vitest'
import changeBaudRateRecipeJson from '../../public/device-catalog/cwt-th04s/change-baudrate.recipe.json'
import changeSlaveIdRecipeJson from '../../public/device-catalog/cwt-th04s/change-slave-id.recipe.json'
import profileJson from '../../public/device-catalog/cwt-th04s/profile.json'
import measurementRecipeJson from '../../public/device-catalog/cwt-th04s/read-measurement.recipe.json'
import type { DeviceCatalog } from '../device-catalog/catalog.types'
import type { DeviceProfile, DeviceProfileSummary } from '../device-catalog/device-profile.types'
import { DeviceProfileValidator } from '../device-catalog/device-profile-validator'
import type { Recipe } from '../device-catalog/recipe.types'
import { appendModbusCrc } from '../modbus/crc16'
import { ModbusRtuClient } from '../modbus/modbus-rtu-client'
import { ModbusFunctionCode } from '../modbus/modbus-types'
import { RecipeExecutor } from '../recipe-engine/recipe-executor'
import { SerialFlowControl, SerialParity, type SerialConfig } from '../serial/serial-types'
import { MockSerialTransport } from '../serial/testing/mock-serial-transport'
import { ConfigurationStatus, type DeviceContext } from './device-configurator'
import { createDeviceMaintenanceServices } from './device-maintenance-services'

/** CWT 실장비와 같은 현재 9600/8N1 설정이다. */
const CURRENT_SERIAL_CONFIG: SerialConfig = Object.freeze({
  baudRate: 9_600,
  dataBits: 8,
  stopBits: 1,
  parity: SerialParity.None,
  flowControl: SerialFlowControl.None,
})

/** 실제 JSON fixture를 검증해 제공하는 integration test Catalog다. */
class CwtTestCatalog implements DeviceCatalog {
  readonly #profile: DeviceProfile
  readonly #recipes: ReadonlyMap<string, Recipe>

  public constructor() {
    const validator = new DeviceProfileValidator()
    this.#profile = validator.validateDeviceProfile(profileJson, 'profile.json')
    const recipes = [measurementRecipeJson, changeSlaveIdRecipeJson, changeBaudRateRecipeJson]
      .map((recipe, index) => validator.validateRecipe(recipe, `recipe-${index}.json`))
    this.#recipes = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  }

  public async load(): Promise<void> {}
  public getProfile(): DeviceProfile { return this.#profile }
  public getRecipe(recipeId: string): Recipe {
    const recipe = this.#recipes.get(recipeId)
    if (!recipe) throw new Error(`Recipe not found: ${recipeId}`)
    return recipe
  }
  public listProfiles(): ReadonlyArray<DeviceProfileSummary> { return [] }
}

describe('Device maintenance CWT integration', () => {
  it('실제 CWT 측정/ID/Baud 변경 Recipe를 Mock RTU transport에서 순서대로 실행한다', async () => {
    const catalog = new CwtTestCatalog()
    const transport = new MockSerialTransport()
    await transport.open(CURRENT_SERIAL_CONFIG)
    const modbusClient = new ModbusRtuClient(transport, 100)
    const recipeExecutor = new RecipeExecutor(catalog, modbusClient, transport)
    const services = createDeviceMaintenanceServices(catalog, recipeExecutor, transport)
    let activeSlaveId = 100

    transport.setWriteHandler((requestFrame) => {
      const requestedSlaveId = requestFrame[0]
      const functionCode = requestFrame[1]
      if (functionCode === ModbusFunctionCode.ReadHoldingRegisters) {
        if (requestedSlaveId !== activeSlaveId) return
        const registerCount = (requestFrame[4] << 8) | requestFrame[5]
        const registerBytes = registerCount === 1 ? [0x02, 0x11] : [0x02, 0x11, 0x01, 0x40]
        transport.emitReceivedBytes(appendModbusCrc(new Uint8Array([
          requestedSlaveId, ModbusFunctionCode.ReadHoldingRegisters, registerBytes.length, ...registerBytes,
        ])))
      }
      if (functionCode === ModbusFunctionCode.WriteSingleRegister) {
        transport.emitReceivedBytes(requestFrame)
        const registerAddress = (requestFrame[2] << 8) | requestFrame[3]
        const slaveIdRegisterAddress = 0x07d0
        if (registerAddress === slaveIdRegisterAddress) {
          activeSlaveId = (requestFrame[4] << 8) | requestFrame[5]
        }
      }
    })

    const currentContext: DeviceContext = Object.freeze({
      profileId: 'cwt-th04s',
      slaveId: 100,
      serialConfig: CURRENT_SERIAL_CONFIG,
    })
    const configurationResult = await services.configurator.changeSlaveId(currentContext, 101)

    expect(configurationResult.status).toBe(ConfigurationStatus.Verified)
    expect(configurationResult.currentContext?.slaveId).toBe(101)
    expect(activeSlaveId).toBe(101)
    expect(transport.writtenFrames.some((frame) => (
      frame[1] === ModbusFunctionCode.WriteSingleRegister
      && frame[2] === 0x07
      && frame[3] === 0xd0
    ))).toBe(true)

    const changedIdContext = configurationResult.currentContext
    if (!changedIdContext) throw new Error('Slave ID 변경 후 context가 필요합니다.')
    const baudResult = await services.configurator.changeBaudRate(changedIdContext, 4_800)
    expect(baudResult.status).toBe(ConfigurationStatus.Verified)
    expect(baudResult.currentContext?.serialConfig.baudRate).toBe(4_800)
    expect(transport.writtenFrames.some((frame) => (
      frame[1] === ModbusFunctionCode.WriteSingleRegister
      && frame[2] === 0x07
      && frame[3] === 0xd1
      && frame[5] === 1
    ))).toBe(true)
    modbusClient.dispose()
  })
})
