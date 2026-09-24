import { describe, expect, it, vi } from 'vitest'
import changeBaudRateRecipeJson from '../../public/device-catalog/cwt-th04s/change-baudrate.recipe.json'
import profileJson from '../../public/device-catalog/cwt-th04s/profile.json'
import measurementRecipeJson from '../../public/device-catalog/cwt-th04s/read-measurement.recipe.json'
import type { DeviceCatalog } from '../device-catalog/catalog.types'
import type { DeviceProfile, DeviceProfileSummary } from '../device-catalog/device-profile.types'
import { DeviceProfileValidator } from '../device-catalog/device-profile-validator'
import type { Recipe } from '../device-catalog/recipe.types'
import type { ModbusClient } from '../modbus/modbus-types'
import { SerialConnectionState } from '../serial/serial-connection-state'
import type { SerialTransport } from '../serial/serial-transport'
import type { SerialConfig } from '../serial/serial-types'
import { RecipeAbortedError, RecipeExecutionError } from './recipe-execution-errors'
import { RecipeExecutor } from './recipe-executor'
import { RecipeExecutionStatus, RecipeStepExecutionStatus } from './recipe-execution.types'

/** JSON fixture를 독립적으로 수정하기 위한 깊은 복사본을 만든다. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

/** 테스트 fixture도 운영 Catalog와 동일한 validator를 거쳐 typed object로 만든다. */
function createValidatedFixtures(extraRecipes: ReadonlyArray<unknown> = []): {
  profile: DeviceProfile
  recipes: Recipe[]
} {
  const validator = new DeviceProfileValidator()
  const profile = validator.validateDeviceProfile(cloneJson(profileJson), 'profile.json')
  const recipeCandidates = [
    measurementRecipeJson,
    changeBaudRateRecipeJson,
    ...extraRecipes,
  ]
  const recipes = recipeCandidates.map((recipe, index) => (
    validator.validateRecipe(cloneJson(recipe), `recipe-${index}.json`)
  ))
  return { profile, recipes }
}

/** 외부 저장 방식 없이 executor 동작만 검증하는 메모리 Catalog다. */
class MemoryDeviceCatalog implements DeviceCatalog {
  readonly #profiles: ReadonlyMap<string, DeviceProfile>
  readonly #recipes: ReadonlyMap<string, Recipe>

  public constructor(profile: DeviceProfile, recipes: ReadonlyArray<Recipe>) {
    this.#profiles = new Map([[profile.id, profile]])
    this.#recipes = new Map(recipes.map((recipe) => [recipe.id, recipe]))
  }

  public async load(): Promise<void> {}

  public getProfile(profileId: string): DeviceProfile {
    const profile = this.#profiles.get(profileId)
    if (!profile) throw new Error(`Profile not found: ${profileId}`)
    return profile
  }

  public getRecipe(recipeId: string): Recipe {
    const recipe = this.#recipes.get(recipeId)
    if (!recipe) throw new Error(`Recipe not found: ${recipeId}`)
    return recipe
  }

  public listProfiles(): ReadonlyArray<DeviceProfileSummary> {
    return [...this.#profiles.values()].map(({ id, manufacturer, model }) => ({ id, manufacturer, model }))
  }
}

/** Recipe가 호출한 Modbus 명령을 관찰할 수 있는 test double이다. */
class RecordingModbusClient implements ModbusClient {
  public readonly reads: Array<Readonly<[number, number, number]>> = []
  public readonly writes: Array<Readonly<[number, number, number]>> = []

  public constructor(private readonly readResult: ReadonlyArray<number> = [529, 320]) {}

  public async readHoldingRegisters(
    slaveId: number,
    address: number,
    count: number,
  ): Promise<ReadonlyArray<number>> {
    this.reads.push([slaveId, address, count])
    return this.readResult
  }

  public async writeSingleRegister(slaveId: number, address: number, value: number): Promise<void> {
    this.writes.push([slaveId, address, value])
  }
}

/** reopen 호출과 전달된 Serial 설정을 기록하는 최소 transport다. */
function createSerialTransport(): SerialTransport & { readonly reopenCalls: SerialConfig[] } {
  const reopenCalls: SerialConfig[] = []
  return {
    connectionState: SerialConnectionState.Connected,
    isSupported: true,
    reopenCalls,
    requestPort: async () => {},
    open: async () => {},
    reconnect: async () => {},
    reopen: async (config) => { reopenCalls.push(config) },
    close: async () => {},
    write: async () => {},
    subscribeData: () => () => {},
    subscribeConnectionState: () => () => {},
    dispose: async () => {},
  }
}

describe('RecipeExecutor', () => {
  it('CWT 측정 Recipe를 실행해 humidity와 signed temperature output을 반환한다', async () => {
    const { profile, recipes } = createValidatedFixtures()
    const modbusClient = new RecordingModbusClient([529, 0xffec])
    const executor = new RecipeExecutor(
      new MemoryDeviceCatalog(profile, recipes),
      modbusClient,
      createSerialTransport(),
    )

    const result = await executor.execute(
      'cwt-th04s',
      'cwt-th04s.read-measurement',
      { deviceId: 100 },
    )

    expect(result.status).toBe(RecipeExecutionStatus.Succeeded)
    expect(result.outputs.humidity.value).toBeCloseTo(52.9)
    expect(result.outputs.humidity.unit).toBe('%RH')
    expect(result.outputs.temperature).toEqual({ value: -2, unit: '°C' })
    expect(modbusClient.reads).toEqual([[100, 0, 2]])
    expect(result.steps[0].status).toBe(RecipeStepExecutionStatus.Succeeded)
  })

  it('parameter 범위 오류는 Modbus 전송 전에 거부한다', async () => {
    const { profile, recipes } = createValidatedFixtures()
    const modbusClient = new RecordingModbusClient()
    const executor = new RecipeExecutor(
      new MemoryDeviceCatalog(profile, recipes),
      modbusClient,
      createSerialTransport(),
    )

    await expect(executor.execute(
      'cwt-th04s',
      'cwt-th04s.read-measurement',
      { deviceId: 0 },
    )).rejects.toThrowError(/1~247 정수/)
    expect(modbusClient.reads).toHaveLength(0)
  })

  it('Profile map을 적용해 baudrate register를 쓰고 port를 다시 연 뒤 응답을 확인한다', async () => {
    const baudRecipe = cloneJson(changeBaudRateRecipeJson)
    const delayStep = baudRecipe.steps.find((step) => step.type === 'delay')
    if (delayStep?.type === 'delay') delayStep.milliseconds = 0
    const validator = new DeviceProfileValidator()
    const profile = validator.validateDeviceProfile(cloneJson(profileJson), 'profile.json')
    const recipes = [baudRecipe].map((recipe, index) => (
      validator.validateRecipe(cloneJson(recipe), `baud-${index}.json`)
    ))
    const modbusClient = new RecordingModbusClient()
    const serialTransport = createSerialTransport()
    const executor = new RecipeExecutor(
      new MemoryDeviceCatalog(profile, recipes),
      modbusClient,
      serialTransport,
    )

    const result = await executor.execute(
      'cwt-th04s',
      'cwt-th04s.change-baudrate',
      { deviceId: 100, targetBaud: 9600 },
    )

    expect(modbusClient.writes).toEqual([[100, 2001, 2]])
    expect(serialTransport.reopenCalls[0].baudRate).toBe(9600)
    expect(modbusClient.reads).toEqual([[100, 0, 1]])
    expect(result.steps).toHaveLength(4)
  })

  it('delay 중 AbortSignal이 취소되면 다음 Step을 실행하지 않는다', async () => {
    const cancellableRecipe = {
      schemaVersion: '1.0',
      id: 'test.cancellable',
      name: '취소 테스트',
      kind: 'measurement',
      steps: [
        { id: 'wait', type: 'delay', milliseconds: 10_000 },
        { id: 'read-after-delay', type: 'readHoldingRegisters', slaveId: 1, address: 0, count: 1, saveAs: 'registers' },
      ],
      onError: 'stop',
    }
    const { profile, recipes } = createValidatedFixtures([cancellableRecipe])
    const modbusClient = new RecordingModbusClient()
    const executor = new RecipeExecutor(
      new MemoryDeviceCatalog(profile, recipes),
      modbusClient,
      createSerialTransport(),
    )
    const abortController = new AbortController()

    const execution = executor.execute('cwt-th04s', 'test.cancellable', {}, abortController.signal)
    abortController.abort('사용자 취소')

    await expect(execution).rejects.toBeInstanceOf(RecipeAbortedError)
    expect(modbusClient.reads).toHaveLength(0)
  })

  it('assertEquals 실패 시 실패한 Step과 앞선 Step 결과를 오류에 보존한다', async () => {
    const assertionRecipe = {
      schemaVersion: '1.0',
      id: 'test.assertion',
      name: '응답 검증 테스트',
      kind: 'measurement',
      steps: [
        { id: 'read', type: 'readHoldingRegisters', slaveId: 1, address: 0, count: 1, saveAs: 'registers' },
        { id: 'verify', type: 'assertEquals', actual: 'registers[0]', expected: 100 },
      ],
      onError: 'stop',
    }
    const { profile, recipes } = createValidatedFixtures([assertionRecipe])
    const executor = new RecipeExecutor(
      new MemoryDeviceCatalog(profile, recipes),
      new RecordingModbusClient([99]),
      createSerialTransport(),
    )

    const execution = executor.execute('cwt-th04s', 'test.assertion')

    await expect(execution).rejects.toMatchObject({
      stepId: 'verify',
      completedSteps: [
        { stepId: 'read', status: RecipeStepExecutionStatus.Succeeded },
        { stepId: 'verify', status: RecipeStepExecutionStatus.Failed },
      ],
    })
  })

  it('미등록 Step 문자열을 함수처럼 실행하지 않고 구조화된 오류로 차단한다', async () => {
    const { profile, recipes } = createValidatedFixtures()
    const unsafeRecipe = {
      ...recipes.find((recipe) => recipe.id === 'cwt-th04s.read-measurement')!,
      id: 'test.unsafe',
      steps: [{ id: 'attempt-code', type: 'constructor.constructor', source: 'alert(1)' }],
    } as unknown as Recipe
    const modbusClient = new RecordingModbusClient()
    const executor = new RecipeExecutor(
      new MemoryDeviceCatalog(profile, [...recipes, unsafeRecipe]),
      modbusClient,
      createSerialTransport(),
    )

    const execution = executor.execute('cwt-th04s', 'test.unsafe', { deviceId: 100 })

    await expect(execution).rejects.toBeInstanceOf(RecipeExecutionError)
    await expect(execution).rejects.toMatchObject({ stepId: 'attempt-code' })
    expect(modbusClient.reads).toHaveLength(0)
  })
})
