import { describe, expect, it } from 'vitest'
import profileJson from '../../public/device-catalog/cwt-th04s/profile.json'
import probeRecipeJson from '../../public/device-catalog/cwt-th04s/probe.recipe.json'
import type { DeviceCatalog } from '../device-catalog/catalog.types'
import type { DeviceProfile, DeviceProfileSummary } from '../device-catalog/device-profile.types'
import { DeviceProfileValidator } from '../device-catalog/device-profile-validator'
import type { Recipe } from '../device-catalog/recipe.types'
import { ModbusExceptionError, ModbusTimeoutError } from '../modbus/modbus-errors'
import { RecipeExecutionError } from '../recipe-engine/recipe-execution-errors'
import { RecipeExecutionStatus, type RecipeExecutionResult, type RecipeRunner } from '../recipe-engine/recipe-execution.types'
import { SerialFlowControl, SerialParity, type SerialConfig } from '../serial/serial-types'
import { MockSerialTransport } from '../serial/testing/mock-serial-transport'
import { DeviceScanner, DeviceScanResponseStatus } from './device-scanner'
import { OperationAbortedError } from './operation-errors'

/** Scanner 테스트용 9600/8N1 설정이다. */
const SERIAL_CONFIG: SerialConfig = Object.freeze({
  baudRate: 9_600,
  dataBits: 8,
  stopBits: 1,
  parity: SerialParity.None,
  flowControl: SerialFlowControl.None,
})

/** RecipeRunner 성공을 나타내는 최소 불변 결과다. */
const SUCCESS_RESULT: RecipeExecutionResult = Object.freeze({
  recipeId: 'cwt-th04s.probe',
  status: RecipeExecutionStatus.Succeeded,
  steps: Object.freeze([]),
  outputs: Object.freeze({}),
  context: Object.freeze({}),
})

/** Profile과 Probe Recipe 하나를 제공하는 in-memory Catalog다. */
class ScannerTestCatalog implements DeviceCatalog {
  readonly #profile: DeviceProfile
  readonly #recipe: Recipe

  public constructor() {
    const validator = new DeviceProfileValidator()
    this.#profile = validator.validateDeviceProfile(profileJson, 'profile.json')
    this.#recipe = validator.validateRecipe(probeRecipeJson, 'probe.json')
  }

  public async load(): Promise<void> {}
  public getProfile(): DeviceProfile { return this.#profile }
  public getRecipe(): Recipe { return this.#recipe }
  public listProfiles(): ReadonlyArray<DeviceProfileSummary> {
    return [{ id: this.#profile.id, manufacturer: this.#profile.manufacturer, model: this.#profile.model }]
  }
}

describe('DeviceScanner', () => {
  it('Slave ID를 순차 Probe하고 정상/exception/무응답을 구분해 진행 상태를 알린다', async () => {
    const calls: number[] = []
    const runner: RecipeRunner = {
      execute: async (_profileId, recipeId, parameters) => {
        const slaveId = parameters?.deviceId as number
        calls.push(slaveId)
        if (slaveId === 101) {
          throw new RecipeExecutionError('probe exception', recipeId, 'read', [], {
            cause: new ModbusExceptionError('illegal address', 2),
          })
        }
        if (slaveId === 102) {
          throw new RecipeExecutionError('probe timeout', recipeId, 'read', [], {
            cause: new ModbusTimeoutError('timeout'),
          })
        }
        return SUCCESS_RESULT
      },
    }
    const transport = new MockSerialTransport()
    await transport.open(SERIAL_CONFIG)
    const scanner = new DeviceScanner(new ScannerTestCatalog(), runner, transport)
    const progressStatuses: DeviceScanResponseStatus[] = []

    const attempts = await scanner.scan(
      { profileId: 'cwt-th04s', serialConfigs: [SERIAL_CONFIG], slaveIds: [100, 101, 102] },
      (attempt) => progressStatuses.push(attempt.status),
    )

    expect(calls).toEqual([100, 101, 102])
    expect(attempts.map((attempt) => attempt.status)).toEqual([
      DeviceScanResponseStatus.Responded,
      DeviceScanResponseStatus.ModbusException,
      DeviceScanResponseStatus.NoResponse,
    ])
    expect(attempts[1].exceptionCode).toBe(2)
    expect(progressStatuses).toEqual(attempts.map((attempt) => attempt.status))
  })

  it('진행 callback에서 취소하면 다음 Slave ID를 전송하지 않는다', async () => {
    const calls: number[] = []
    const runner: RecipeRunner = {
      execute: async (_profileId, _recipeId, parameters) => {
        calls.push(parameters?.deviceId as number)
        return SUCCESS_RESULT
      },
    }
    const transport = new MockSerialTransport()
    await transport.open(SERIAL_CONFIG)
    const scanner = new DeviceScanner(new ScannerTestCatalog(), runner, transport)
    const abortController = new AbortController()

    const scan = scanner.scan(
      { profileId: 'cwt-th04s', serialConfigs: [SERIAL_CONFIG], slaveIds: [100, 101] },
      () => abortController.abort('사용자 취소'),
      abortController.signal,
    )

    await expect(scan).rejects.toBeInstanceOf(OperationAbortedError)
    expect(calls).toEqual([100])
  })
})
