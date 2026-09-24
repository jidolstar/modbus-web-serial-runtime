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
import type { SerialTransport } from '../serial/serial-transport'
import { SerialConnectionState } from '../serial/serial-connection-state'
import { SerialFlowControl, SerialParity, type SerialConfig } from '../serial/serial-types'
import { ConfigurationStatus, DeviceConfigurator, type DeviceContext } from './device-configurator'

/** 설정 변경 테스트에서 사용하는 현재 9600/8N1 설정이다. */
const SERIAL_CONFIG: SerialConfig = Object.freeze({
  baudRate: 9_600,
  dataBits: 8,
  stopBits: 1,
  parity: SerialParity.None,
  flowControl: SerialFlowControl.None,
})

/** 설정 변경 전 장비 context다. */
const CURRENT_CONTEXT: DeviceContext = Object.freeze({
  profileId: 'cwt-th04s',
  slaveId: 100,
  serialConfig: SERIAL_CONFIG,
})

/** Script 성공 시 반환할 최소 Recipe 결과다. */
const SUCCESS_RESULT: RecipeExecutionResult = Object.freeze({
  recipeId: 'scripted',
  status: RecipeExecutionStatus.Succeeded,
  steps: Object.freeze([]),
  outputs: Object.freeze({}),
  context: Object.freeze({}),
})

/** 실행 순서대로 성공 또는 오류를 반환하는 RecipeRunner다. */
class ScriptedRecipeRunner implements RecipeRunner {
  public readonly calls: Array<{ recipeId: string; parameters: Readonly<Record<string, unknown>> }> = []

  public constructor(private readonly script: Array<RecipeExecutionResult | Error>) {}

  public async execute(
    _profileId: string,
    recipeId: string,
    parameters: Readonly<Record<string, unknown>> = {},
  ): Promise<RecipeExecutionResult> {
    this.calls.push({ recipeId, parameters })
    const next = this.script.shift()
    if (next instanceof Error) throw next
    if (!next) throw new Error('ScriptedRecipeRunner 응답이 부족합니다.')
    return next
  }
}

/** reopen 설정을 기록하는 transport test double이다. */
class RecordingTransport implements SerialTransport {
  public readonly reopenedConfigs: SerialConfig[] = []
  public readonly connectionState = SerialConnectionState.Connected
  public readonly isSupported = true

  public async requestPort(): Promise<void> {}
  public async open(): Promise<void> {}
  public async reconnect(): Promise<void> {}
  public async reopen(config: SerialConfig): Promise<void> { this.reopenedConfigs.push(config) }
  public async close(): Promise<void> {}
  public async write(): Promise<void> {}
  public subscribeData(): () => void { return () => {} }
  public subscribeConnectionState(): () => void { return () => {} }
  public async dispose(): Promise<void> {}
}

/** 실제 CWT Profile을 제공하는 최소 Catalog다. */
class ConfiguratorTestCatalog implements DeviceCatalog {
  readonly #validator = new DeviceProfileValidator()
  readonly #profile: DeviceProfile
  readonly #recipes: Map<string, Recipe>

  public constructor(
    profileCandidate: unknown = profileJson,
    recipeCandidates: ReadonlyArray<unknown> = [changeSlaveIdRecipeJson, changeBaudRateRecipeJson],
  ) {
    this.#profile = this.#validator.validateDeviceProfile(profileCandidate, 'profile.json')
    this.#recipes = new Map(
      recipeCandidates
      .map((recipe, index) => this.#validator.validateRecipe(recipe, `recipe-${index}.json`))
      .map((recipe) => [recipe.id, recipe]),
    )
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

/** 원인과 실패 Step을 가진 Recipe 오류를 만든다. */
function recipeFailure(stepId: string, cause: Error): RecipeExecutionError {
  return new RecipeExecutionError('script failure', 'recipe', stepId, [], { cause })
}

describe('DeviceConfigurator', () => {
  it('현재 ID와 목표 ID를 확인한 뒤 CWT ID 변경 Recipe 성공을 verified로 반환한다', async () => {
    const targetNoResponse = recipeFailure('read', new ModbusTimeoutError('no target'))
    const runner = new ScriptedRecipeRunner([SUCCESS_RESULT, targetNoResponse, SUCCESS_RESULT])
    const configurator = new DeviceConfigurator(
      new ConfiguratorTestCatalog(),
      runner,
      new RecordingTransport(),
    )

    const result = await configurator.changeSlaveId(CURRENT_CONTEXT, 101)

    expect(result.status).toBe(ConfigurationStatus.Verified)
    expect(result.currentContext?.slaveId).toBe(101)
    expect(runner.calls[2]).toEqual({
      recipeId: 'cwt-th04s.change-slave-id',
      parameters: { currentId: 100, targetId: 101 },
    })
  })

  it('ID write 후 새 ID가 없고 기존 ID가 응답하면 verification-failed로 구분한다', async () => {
    const timeout = () => recipeFailure('read', new ModbusTimeoutError('timeout'))
    const changeFailure = recipeFailure('verify-new-slave-id', new ModbusTimeoutError('verify timeout'))
    const runner = new ScriptedRecipeRunner([
      SUCCESS_RESULT,
      timeout(),
      changeFailure,
      timeout(),
      SUCCESS_RESULT,
    ])
    const configurator = new DeviceConfigurator(new ConfiguratorTestCatalog(), runner, new RecordingTransport())

    const result = await configurator.changeSlaveId(CURRENT_CONTEXT, 101)

    expect(result.status).toBe(ConfigurationStatus.VerificationFailed)
    expect(result.currentContext?.slaveId).toBe(100)
    expect(result.failedStepId).toBe('verify-new-slave-id')
  })

  it('Baud 변경 검증 실패 후 이전 baud 측정 응답을 recovered 상태로 반환한다', async () => {
    const changeFailure = recipeFailure('verify-new-baudrate', new ModbusTimeoutError('verify timeout'))
    const runner = new ScriptedRecipeRunner([SUCCESS_RESULT, changeFailure, SUCCESS_RESULT])
    const transport = new RecordingTransport()
    const configurator = new DeviceConfigurator(new ConfiguratorTestCatalog(), runner, transport)

    const result = await configurator.changeBaudRate(CURRENT_CONTEXT, 4_800)

    expect(result.status).toBe(ConfigurationStatus.RecoveredOnPreviousConfig)
    expect(result.currentContext?.serialConfig.baudRate).toBe(9_600)
    expect(transport.reopenedConfigs.map((config) => config.baudRate)).toEqual([9_600])
  })

  it('Baud write를 장비가 exception으로 거부하면 write-failed로 구분한다', async () => {
    const writeFailure = recipeFailure(
      'write-new-baudrate',
      new ModbusExceptionError('illegal value', 3),
    )
    const runner = new ScriptedRecipeRunner([SUCCESS_RESULT, writeFailure])
    const configurator = new DeviceConfigurator(
      new ConfiguratorTestCatalog(),
      runner,
      new RecordingTransport(),
    )

    const result = await configurator.changeBaudRate(CURRENT_CONTEXT, 4_800)

    expect(result.status).toBe(ConfigurationStatus.WriteFailed)
    expect(result.currentContext).toBe(CURRENT_CONTEXT)
  })

  it('이전 baud와 새 baud 모두 장비를 찾지 못하면 device-state-unknown으로 반환한다', async () => {
    const timeout = (stepId: string) => recipeFailure(stepId, new ModbusTimeoutError('timeout'))
    const runner = new ScriptedRecipeRunner([
      SUCCESS_RESULT,
      timeout('verify-new-baudrate'),
      timeout('old-baud-check'),
      timeout('new-baud-check'),
    ])
    const transport = new RecordingTransport()
    const configurator = new DeviceConfigurator(new ConfiguratorTestCatalog(), runner, transport)

    const result = await configurator.changeBaudRate(CURRENT_CONTEXT, 4_800)

    expect(result.status).toBe(ConfigurationStatus.DeviceStateUnknown)
    expect(result.currentContext).toBeNull()
    expect(transport.reopenedConfigs.map((config) => config.baudRate)).toEqual([9_600, 4_800])
  })

  it('전원 재인가형 ID 변경은 새 ID를 확정하지 않고 사용자 조치와 대기 context를 반환한다', async () => {
    const deferredRecipe = {
      ...changeSlaveIdRecipeJson,
      applyMode: 'after-power-cycle',
      steps: [changeSlaveIdRecipeJson.steps[0]],
    }
    const targetNoResponse = recipeFailure('read', new ModbusTimeoutError('no target'))
    const runner = new ScriptedRecipeRunner([SUCCESS_RESULT, targetNoResponse, SUCCESS_RESULT])
    const configurator = new DeviceConfigurator(
      new ConfiguratorTestCatalog(profileJson, [deferredRecipe, changeBaudRateRecipeJson]),
      runner,
      new RecordingTransport(),
    )

    const result = await configurator.changeSlaveId(CURRENT_CONTEXT, 101)

    expect(result.status).toBe(ConfigurationStatus.PowerCycleRequired)
    expect(result.currentContext).toBe(CURRENT_CONTEXT)
    expect(result.pendingContext?.slaveId).toBe(101)
    expect(result.requiredAction).toBe('power-cycle-and-verify')
  })

  it('전원 재인가형 baud 변경은 port를 다시 열지 않고 목표 baud 확인을 대기시킨다', async () => {
    const deferredRecipe = {
      ...changeBaudRateRecipeJson,
      applyMode: 'after-power-cycle',
      steps: [changeBaudRateRecipeJson.steps[0]],
    }
    const transport = new RecordingTransport()
    const configurator = new DeviceConfigurator(
      new ConfiguratorTestCatalog(profileJson, [changeSlaveIdRecipeJson, deferredRecipe]),
      new ScriptedRecipeRunner([SUCCESS_RESULT, SUCCESS_RESULT]),
      transport,
    )

    const result = await configurator.changeBaudRate(CURRENT_CONTEXT, 4_800)

    expect(result.status).toBe(ConfigurationStatus.PowerCycleRequired)
    expect(result.currentContext).toBe(CURRENT_CONTEXT)
    expect(result.pendingContext?.serialConfig.baudRate).toBe(4_800)
    expect(result.requiredAction).toBe('power-cycle-and-verify')
    expect(transport.reopenedConfigs).toEqual([])
  })
})
