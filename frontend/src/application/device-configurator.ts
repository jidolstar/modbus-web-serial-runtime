import type { DeviceCatalog } from '../device-catalog/catalog.types'
import { STANDARD_DEVICE_ID_PARAMETER } from '../device-catalog/recipe.types'
import { ModbusExceptionError } from '../modbus/modbus-errors'
import { RecipeExecutionError } from '../recipe-engine/recipe-execution-errors'
import type { RecipeRunner } from '../recipe-engine/recipe-execution.types'
import type { SerialConfig } from '../serial/serial-types'
import { findErrorCause, throwIfOperationAborted } from './operation-errors'

/** 설정 쓰기 뒤 호출자가 수행해야 하는 수동 확인 절차를 구분한다. */
export enum ConfigurationStatus {
  ReconnectRequired = 'reconnect-required', // 쓰기 응답을 받았으며 새 설정으로 목표값 확인이 필요하다.
  WriteRejected = 'write-rejected', // 장비가 Modbus exception으로 쓰기 요청을 명시적으로 거부했다.
  DeliveryUncertain = 'delivery-uncertain', // timeout·분리 등으로 실제 적용 여부를 판단할 수 없다.
}

/** 사용자가 선택한 Catalog와 현재 확인된 통신 설정이다. */
export interface DeviceContext {
  readonly profileId: string // 실행할 Profile ID. 예: "cwt-th04s"
  readonly slaveId: number // 현재 확인된 Modbus 주소. 예: 1
  readonly serialConfig: SerialConfig // 현재 확인된 Web Serial 설정. 예: 9600/8N1
}

/** 설정 쓰기 결과이며 목표값은 재연결 검증 전까지 현재값으로 확정하지 않는다. */
export interface ConfigurationResult {
  readonly status: ConfigurationStatus
  readonly previousContext: DeviceContext
  readonly pendingContext?: DeviceContext // 적용 가능성이 있을 때 사용자가 다시 확인할 목표 설정이다.
  readonly failedStepId?: string
  readonly error?: Error
}

const CURRENT_ID_PARAMETER = 'currentId' // Slave ID 변경 Recipe가 받는 현재 주소 parameter다.
const TARGET_ID_PARAMETER = 'targetId' // Slave ID 변경 Recipe가 register에 기록할 목표 주소다.
const TARGET_BAUD_PARAMETER = 'targetBaud' // baudrate map 조회에 사용하는 실제 통신 속도다.

/**
 * Test Device 설정 화면이 호출해 표준 Slave ID 또는 baudrate 변경 Recipe를 한 번 실행한다.
 * 적용 확인과 Serial 재연결은 수행하지 않으며, 호출자는 결과를 받은 뒤 현재 연결을 종료해야 한다.
 */
export class DeviceConfigurator {
  public constructor(
    private readonly catalog: DeviceCatalog,
    private readonly recipeRunner: RecipeRunner,
  ) {}

  /** 현재값과 목표값을 검증한 뒤 Slave ID 쓰기 결과와 수동 확인 대상을 반환한다. */
  public async changeSlaveId(
    currentContext: DeviceContext,
    targetSlaveId: number,
    signal?: AbortSignal,
  ): Promise<ConfigurationResult> {
    const profile = this.catalog.getProfile(currentContext.profileId)
    const recipeId = profile.recipes.changeSlaveId
    if (!recipeId) throw new Error(`Slave ID 변경을 지원하지 않는 Profile입니다: ${profile.id}`)
    this.#validateContext(profile, currentContext)
    this.#validateSlaveId(profile, targetSlaveId)
    throwIfOperationAborted(signal)

    const pendingContext = Object.freeze({ ...currentContext, slaveId: targetSlaveId })
    return this.#executeChange(
      currentContext,
      pendingContext,
      recipeId,
      { [CURRENT_ID_PARAMETER]: currentContext.slaveId, [TARGET_ID_PARAMETER]: targetSlaveId },
      signal,
    )
  }

  /** 지원 목록을 확인한 뒤 baudrate 쓰기 결과와 수동 확인 대상을 반환한다. */
  public async changeBaudRate(
    currentContext: DeviceContext,
    targetBaudRate: number,
    signal?: AbortSignal,
  ): Promise<ConfigurationResult> {
    const profile = this.catalog.getProfile(currentContext.profileId)
    const recipeId = profile.recipes.changeBaudRate
    if (!recipeId) throw new Error(`Baudrate 변경을 지원하지 않는 Profile입니다: ${profile.id}`)
    this.#validateContext(profile, currentContext)
    if (!profile.serial.supportedBaudRates.includes(targetBaudRate)) {
      throw new Error(`Profile이 지원하지 않는 baudrate입니다: ${targetBaudRate}`)
    }
    throwIfOperationAborted(signal)

    const pendingContext = Object.freeze({
      ...currentContext,
      serialConfig: Object.freeze({ ...currentContext.serialConfig, baudRate: targetBaudRate }),
    })
    return this.#executeChange(
      currentContext,
      pendingContext,
      recipeId,
      { [STANDARD_DEVICE_ID_PARAMETER]: currentContext.slaveId, [TARGET_BAUD_PARAMETER]: targetBaudRate },
      signal,
    )
  }

  /**
   * 장비 쓰기를 자동 재실행하지 않고 한 번만 수행한다.
   * 응답 유실 뒤 실제 설정이 바뀔 수 있으므로 명시적 Modbus 거부 외 오류에는 pending 값을 보존한다.
   */
  async #executeChange(
    previousContext: DeviceContext,
    pendingContext: DeviceContext,
    recipeId: string,
    parameters: Readonly<Record<string, unknown>>,
    signal?: AbortSignal,
  ): Promise<ConfigurationResult> {
    try {
      await this.recipeRunner.execute(previousContext.profileId, recipeId, parameters, signal)
      return Object.freeze({ status: ConfigurationStatus.ReconnectRequired, previousContext, pendingContext })
    } catch (caught) {
      const error = this.#toError(caught)
      const failedStepId = caught instanceof RecipeExecutionError ? caught.stepId : undefined
      if (findErrorCause(caught, ModbusExceptionError)) {
        return Object.freeze({ status: ConfigurationStatus.WriteRejected, previousContext, failedStepId, error })
      }
      return Object.freeze({
        status: ConfigurationStatus.DeliveryUncertain,
        previousContext,
        pendingContext,
        failedStepId,
        error,
      })
    }
  }

  /** 현재 연결 context가 Profile 범위 안인지 장비 I/O 전에 검사한다. */
  #validateContext(profile: ReturnType<DeviceCatalog['getProfile']>, context: DeviceContext): void {
    this.#validateSlaveId(profile, context.slaveId)
    if (!profile.serial.supportedBaudRates.includes(context.serialConfig.baudRate)) {
      throw new Error(`현재 baudrate가 Profile 지원 목록에 없습니다: ${context.serialConfig.baudRate}`)
    }
  }

  #validateSlaveId(profile: ReturnType<DeviceCatalog['getProfile']>, slaveId: number): void {
    if (!Number.isInteger(slaveId) || slaveId < profile.slave.minId || slaveId > profile.slave.maxId) {
      throw new Error(`Slave ID는 ${profile.slave.minId}~${profile.slave.maxId} 정수여야 합니다.`)
    }
  }

  #toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }
}
