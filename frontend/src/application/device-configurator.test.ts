import { describe, expect, it } from 'vitest'
import changeBaudRateRecipeJson from '../../public/device-catalog/cwt-th04s/change-baudrate.recipe.json'
import changeSlaveIdRecipeJson from '../../public/device-catalog/cwt-th04s/change-slave-id.recipe.json'
import profileJson from '../../public/device-catalog/cwt-th04s/profile.json'
import type { DeviceCatalog } from '../device-catalog/catalog.types'
import type { DeviceProfile, DeviceProfileSummary } from '../device-catalog/device-profile.types'
import { DeviceProfileValidator } from '../device-catalog/device-profile-validator'
import type { Recipe } from '../device-catalog/recipe.types'
import { ModbusExceptionError, ModbusTimeoutError } from '../modbus/modbus-errors'
import { RecipeExecutionError } from '../recipe-engine/recipe-execution-errors'
import { RecipeExecutionStatus, type RecipeExecutionResult, type RecipeRunner } from '../recipe-engine/recipe-execution.types'
import { SerialFlowControl, SerialParity, type SerialConfig } from '../serial/serial-types'
import { ConfigurationStatus, DeviceConfigurator, type DeviceContext } from './device-configurator'

const SERIAL_CONFIG: SerialConfig = Object.freeze({
  baudRate: 9_600, dataBits: 8, stopBits: 1, parity: SerialParity.None, flowControl: SerialFlowControl.None,
})
const CURRENT_CONTEXT: DeviceContext = Object.freeze({ profileId: 'cwt-th04s', slaveId: 100, serialConfig: SERIAL_CONFIG })
const SUCCESS_RESULT: RecipeExecutionResult = Object.freeze({
  recipeId: 'scripted', status: RecipeExecutionStatus.Succeeded, steps: Object.freeze([]), outputs: Object.freeze({}), context: Object.freeze({}),
})

/** 설정 서비스가 Recipe를 자동 재실행하지 않는지 호출 횟수와 parameter를 기록한다. */
class ScriptedRecipeRunner implements RecipeRunner {
  public readonly calls: Array<{ recipeId: string; parameters: Readonly<Record<string, unknown>> }> = []
  public constructor(private readonly response: RecipeExecutionResult | Error) {}
  public async execute(_profileId: string, recipeId: string, parameters: Readonly<Record<string, unknown>> = {}): Promise<RecipeExecutionResult> {
    this.calls.push({ recipeId, parameters })
    if (this.response instanceof Error) throw this.response
    return this.response
  }
}

/** 실제 CWT fixture를 검증한 뒤 설정 테스트에 제공하는 최소 Catalog다. */
class ConfiguratorTestCatalog implements DeviceCatalog {
  readonly #validator = new DeviceProfileValidator()
  readonly #profile: DeviceProfile = this.#validator.validateDeviceProfile(profileJson, 'profile.json')
  readonly #recipes = new Map<string, Recipe>([changeSlaveIdRecipeJson, changeBaudRateRecipeJson]
    .map((candidate, index) => this.#validator.validateRecipe(candidate, `recipe-${index}.json`))
    .map((recipe) => [recipe.id, recipe]))
  public async load(): Promise<void> {}
  public getProfile(): DeviceProfile { return this.#profile }
  public getRecipe(recipeId: string): Recipe {
    const recipe = this.#recipes.get(recipeId)
    if (!recipe) throw new Error(`Recipe not found: ${recipeId}`)
    return recipe
  }
  public listProfiles(): ReadonlyArray<DeviceProfileSummary> { return [] }
}

function recipeFailure(stepId: string, cause: Error): RecipeExecutionError {
  return new RecipeExecutionError('script failure', 'recipe', stepId, [], { cause })
}

describe('DeviceConfigurator', () => {
  it('Slave ID write 성공 뒤 자동 검증 없이 목표 context를 reconnect-required로 반환한다', async () => {
    const runner = new ScriptedRecipeRunner(SUCCESS_RESULT)
    const result = await new DeviceConfigurator(new ConfiguratorTestCatalog(), runner).changeSlaveId(CURRENT_CONTEXT, 101)

    expect(result.status).toBe(ConfigurationStatus.ReconnectRequired)
    expect(result.previousContext).toBe(CURRENT_CONTEXT)
    expect(result.pendingContext?.slaveId).toBe(101)
    expect(runner.calls).toEqual([{ recipeId: 'cwt-th04s.change-slave-id', parameters: { currentId: 100, targetId: 101 } }])
  })

  it('baudrate write 성공 뒤 목표 baudrate만 pending으로 반환한다', async () => {
    const runner = new ScriptedRecipeRunner(SUCCESS_RESULT)
    const result = await new DeviceConfigurator(new ConfiguratorTestCatalog(), runner).changeBaudRate(CURRENT_CONTEXT, 4_800)

    expect(result.status).toBe(ConfigurationStatus.ReconnectRequired)
    expect(result.pendingContext?.serialConfig.baudRate).toBe(4_800)
    expect(result.pendingContext?.slaveId).toBe(100)
    expect(runner.calls).toHaveLength(1)
  })

  it('장비의 명시적 Modbus exception은 목표값 없이 write-rejected로 반환한다', async () => {
    const failure = recipeFailure('write-new-baudrate', new ModbusExceptionError('illegal value', 3))
    const result = await new DeviceConfigurator(new ConfiguratorTestCatalog(), new ScriptedRecipeRunner(failure))
      .changeBaudRate(CURRENT_CONTEXT, 4_800)

    expect(result.status).toBe(ConfigurationStatus.WriteRejected)
    expect(result.pendingContext).toBeUndefined()
    expect(result.failedStepId).toBe('write-new-baudrate')
  })

  it('timeout은 실제 적용 가능성을 보존해 delivery-uncertain과 목표값을 반환한다', async () => {
    const failure = recipeFailure('write-new-slave-id', new ModbusTimeoutError('timeout'))
    const result = await new DeviceConfigurator(new ConfiguratorTestCatalog(), new ScriptedRecipeRunner(failure))
      .changeSlaveId(CURRENT_CONTEXT, 101)

    expect(result.status).toBe(ConfigurationStatus.DeliveryUncertain)
    expect(result.pendingContext?.slaveId).toBe(101)
    expect(result.failedStepId).toBe('write-new-slave-id')
  })

  it('Profile 범위를 벗어난 목표값은 Recipe 실행 전에 거부한다', async () => {
    const runner = new ScriptedRecipeRunner(SUCCESS_RESULT)
    await expect(new DeviceConfigurator(new ConfiguratorTestCatalog(), runner).changeSlaveId(CURRENT_CONTEXT, 248))
      .rejects.toThrow(/1~247/)
    expect(runner.calls).toHaveLength(0)
  })
})
