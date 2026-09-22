import type { DeviceCatalog } from '../device-catalog/catalog.types'
import { RecipeStepType, STANDARD_DEVICE_ID_PARAMETER } from '../device-catalog/recipe.types'
import { ModbusExceptionError, ModbusTimeoutError } from '../modbus/modbus-errors'
import { RecipeAbortedError, RecipeExecutionError } from '../recipe-engine/recipe-execution-errors'
import type { RecipeRunner } from '../recipe-engine/recipe-execution.types'
import type { SerialTransport } from '../serial/serial-transport'
import type { SerialConfig } from '../serial/serial-types'
import { findErrorCause, OperationAbortedError, throwIfOperationAborted } from './operation-errors'

/** 설정 변경의 검증 수준과 최종 장비 상태를 나타낸다. */
export enum ConfigurationStatus {
  Verified = 'verified',
  WriteFailed = 'write-failed',
  VerificationFailed = 'verification-failed',
  RecoveredOnPreviousConfig = 'recovered-on-previous-config',
  DeviceStateUnknown = 'device-state-unknown',
}

/** 현재 장비 instance를 식별하고 연결하는 데 필요한 값이다. */
export interface DeviceContext {
  /** 장비 동작과 설정 Recipe를 제공하는 Profile ID다. */
  readonly profileId: string

  /** 현재 검증된 Modbus Slave ID다. */
  readonly slaveId: number

  /** 현재 검증된 Serial Port 설정이다. */
  readonly serialConfig: SerialConfig
}

/** 설정 변경 결과와 검증된 context를 boolean 대신 명시적으로 반환한다. */
export interface ConfigurationResult {
  /** 변경 및 사후 검증 결과의 명시적인 분류다. */
  readonly status: ConfigurationStatus

  /** 변경 시도 전 검증된 장비 context다. */
  readonly previousContext: DeviceContext

  /** 변경 후 확인된 context이며 상태를 특정할 수 없으면 null이다. */
  readonly currentContext: DeviceContext | null

  /** Recipe가 실패했을 때 마지막으로 실행한 Step ID다. */
  readonly failedStepId?: string

  /** 진단에 사용할 원본 실행 오류다. */
  readonly error?: Error
}

/** Probe 결과를 설정 workflow 내부 판단에만 사용하는 닫힌 집합이다. */
enum ProbeOutcome {
  Reachable = 'reachable',
  NoResponse = 'no-response',
  Failed = 'failed',
}

/** Probe 결과와 원본 오류를 함께 보관한다. */
interface ProbeResult {
  readonly outcome: ProbeOutcome
  readonly error?: Error
}

/** CWT Recipe가 사용하는 설정 변경 parameter 이름이다. */
const CURRENT_ID_PARAMETER = 'currentId'
const TARGET_ID_PARAMETER = 'targetId'
const TARGET_BAUD_PARAMETER = 'targetBaud'

/**
 * Profile Recipe를 이용해 Slave ID와 baudrate를 변경하고 결과를 재검증한다.
 *
 * write 응답 손실은 실제 적용 여부를 보장하지 않으므로 새/이전 context를 Probe한
 * 뒤에만 verified 또는 recovered 상태를 반환한다.
 */
export class DeviceConfigurator {
  public constructor(
    private readonly catalog: DeviceCatalog,
    private readonly recipeRunner: RecipeRunner,
    private readonly serialTransport: SerialTransport,
  ) {}

  /** Slave ID 충돌 여부를 확인하고 변경 후 새 ID 또는 기존 ID 상태를 검증한다. */
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

    const currentProbe = await this.#probe(currentContext, signal)
    if (currentProbe.outcome !== ProbeOutcome.Reachable) {
      return this.#result(
        currentProbe.outcome === ProbeOutcome.NoResponse
          ? ConfigurationStatus.VerificationFailed
          : ConfigurationStatus.DeviceStateUnknown,
        currentContext,
        currentProbe.outcome === ProbeOutcome.NoResponse ? null : currentContext,
        currentProbe.error,
      )
    }

    const targetContext = Object.freeze({ ...currentContext, slaveId: targetSlaveId })
    const targetBeforeWrite = await this.#probe(targetContext, signal)
    if (targetBeforeWrite.outcome === ProbeOutcome.Reachable) {
      return this.#result(
        ConfigurationStatus.VerificationFailed,
        currentContext,
        currentContext,
        new Error(`목표 Slave ID ${targetSlaveId}에서 이미 장비 응답이 있습니다.`),
      )
    }
    if (targetBeforeWrite.outcome === ProbeOutcome.Failed) {
      return this.#result(
        ConfigurationStatus.DeviceStateUnknown,
        currentContext,
        currentContext,
        targetBeforeWrite.error,
      )
    }

    try {
      await this.recipeRunner.execute(
        profile.id,
        recipeId,
        { [CURRENT_ID_PARAMETER]: currentContext.slaveId, [TARGET_ID_PARAMETER]: targetSlaveId },
        signal,
      )
      return this.#result(ConfigurationStatus.Verified, currentContext, targetContext)
    } catch (error) {
      this.#throwIfCancelled(error, signal)
      const failedStepId = error instanceof RecipeExecutionError ? error.stepId : undefined
      if (findErrorCause(error, ModbusExceptionError)
        && this.#failedStepIsWrite(recipeId, failedStepId)) {
        return this.#result(ConfigurationStatus.WriteFailed, currentContext, currentContext, this.#toError(error), failedStepId)
      }

      const targetAfterWrite = await this.#probe(targetContext, signal)
      if (targetAfterWrite.outcome === ProbeOutcome.Reachable) {
        return this.#result(ConfigurationStatus.Verified, currentContext, targetContext, this.#toError(error), failedStepId)
      }
      const previousAfterWrite = await this.#probe(currentContext, signal)
      if (previousAfterWrite.outcome === ProbeOutcome.Reachable) {
        return this.#result(ConfigurationStatus.VerificationFailed, currentContext, currentContext, this.#toError(error), failedStepId)
      }
      return this.#result(ConfigurationStatus.DeviceStateUnknown, currentContext, null, this.#toError(error), failedStepId)
    }
  }

  /** Baudrate 변경 실패 시 이전 baud로 reopen하고 Probe해 복구 여부를 구분한다. */
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

    const currentProbe = await this.#probe(currentContext, signal)
    if (currentProbe.outcome !== ProbeOutcome.Reachable) {
      return this.#result(
        currentProbe.outcome === ProbeOutcome.NoResponse
          ? ConfigurationStatus.VerificationFailed
          : ConfigurationStatus.DeviceStateUnknown,
        currentContext,
        currentProbe.outcome === ProbeOutcome.NoResponse ? null : currentContext,
        currentProbe.error,
      )
    }

    const targetContext = Object.freeze({
      ...currentContext,
      serialConfig: Object.freeze({ ...currentContext.serialConfig, baudRate: targetBaudRate }),
    })
    try {
      await this.recipeRunner.execute(
        profile.id,
        recipeId,
        { [STANDARD_DEVICE_ID_PARAMETER]: currentContext.slaveId, [TARGET_BAUD_PARAMETER]: targetBaudRate },
        signal,
      )
      return this.#result(ConfigurationStatus.Verified, currentContext, targetContext)
    } catch (error) {
      this.#throwIfCancelled(error, signal)
      const failedStepId = error instanceof RecipeExecutionError ? error.stepId : undefined
      if (findErrorCause(error, ModbusExceptionError)
        && this.#failedStepIsWrite(recipeId, failedStepId)) {
        return this.#result(ConfigurationStatus.WriteFailed, currentContext, currentContext, this.#toError(error), failedStepId)
      }

      const recoveryResult = await this.#recoverPreviousBaud(currentContext, signal)
      if (recoveryResult.outcome === ProbeOutcome.Reachable) {
        return this.#result(
          ConfigurationStatus.RecoveredOnPreviousConfig,
          currentContext,
          currentContext,
          this.#toError(error),
          failedStepId,
        )
      }

      // 이전 baud에서 찾지 못하면 새 baud를 한 번 확인해 응답 손실 뒤 적용된 경우를 복구한다.
      const targetProbe = await this.#reopenAndProbe(targetContext, signal)
      if (targetProbe.outcome === ProbeOutcome.Reachable) {
        return this.#result(ConfigurationStatus.Verified, currentContext, targetContext, this.#toError(error), failedStepId)
      }
      return this.#result(ConfigurationStatus.DeviceStateUnknown, currentContext, null, this.#toError(error), failedStepId)
    }
  }

  /** 지정 context 설정으로 port를 연 뒤 Profile Probe를 실행한다. */
  async #reopenAndProbe(context: DeviceContext, signal?: AbortSignal): Promise<ProbeResult> {
    throwIfOperationAborted(signal)
    try {
      await this.serialTransport.reopen(context.serialConfig)
    } catch (error) {
      return Object.freeze({ outcome: ProbeOutcome.Failed, error: this.#toError(error) })
    }
    return this.#probe(context, signal)
  }

  /** 이전 baudrate로 transport와 장비 응답을 함께 복구한다. */
  #recoverPreviousBaud(context: DeviceContext, signal?: AbortSignal): Promise<ProbeResult> {
    return this.#reopenAndProbe(context, signal)
  }

  /** 정상 응답과 Modbus exception은 모두 해당 Slave의 존재 신호로 처리한다. */
  async #probe(context: DeviceContext, signal?: AbortSignal): Promise<ProbeResult> {
    throwIfOperationAborted(signal)
    const profile = this.catalog.getProfile(context.profileId)
    try {
      await this.recipeRunner.execute(
        profile.id,
        profile.recipes.probe,
        { [STANDARD_DEVICE_ID_PARAMETER]: context.slaveId },
        signal,
      )
      return Object.freeze({ outcome: ProbeOutcome.Reachable })
    } catch (error) {
      this.#throwIfCancelled(error, signal)
      if (findErrorCause(error, ModbusExceptionError)) {
        return Object.freeze({ outcome: ProbeOutcome.Reachable, error: this.#toError(error) })
      }
      if (findErrorCause(error, ModbusTimeoutError)) {
        return Object.freeze({ outcome: ProbeOutcome.NoResponse, error: this.#toError(error) })
      }
      return Object.freeze({ outcome: ProbeOutcome.Failed, error: this.#toError(error) })
    }
  }

  /** 현재 DeviceContext가 Profile 범위와 일치하는지 확인한다. */
  #validateContext(
    profile: ReturnType<DeviceCatalog['getProfile']>,
    context: DeviceContext,
  ): void {
    this.#validateSlaveId(profile, context.slaveId)
    if (!profile.serial.supportedBaudRates.includes(context.serialConfig.baudRate)) {
      throw new Error(`현재 baudrate가 Profile 지원 목록에 없습니다: ${context.serialConfig.baudRate}`)
    }
  }

  /** Slave ID 정수 범위를 Profile 값으로 검사한다. */
  #validateSlaveId(profile: ReturnType<DeviceCatalog['getProfile']>, slaveId: number): void {
    if (!Number.isInteger(slaveId)
      || slaveId < profile.slave.minId
      || slaveId > profile.slave.maxId) {
      throw new Error(`Slave ID는 ${profile.slave.minId}~${profile.slave.maxId} 정수여야 합니다.`)
    }
  }

  /** 장비별 Step ID 문자열 대신 Recipe 정의의 Step type으로 write 실패를 판정한다. */
  #failedStepIsWrite(recipeId: string, failedStepId?: string): boolean {
    if (!failedStepId) return false
    const failedStep = this.catalog.getRecipe(recipeId).steps.find((step) => step.id === failedStepId)
    return failedStep?.type === RecipeStepType.WriteSingleRegister
  }

  /** AbortSignal과 Recipe 취소 오류를 동일한 application 취소 오류로 변환한다. */
  #throwIfCancelled(error: unknown, signal?: AbortSignal): void {
    if (signal?.aborted || error instanceof RecipeAbortedError || error instanceof OperationAbortedError) {
      throw new OperationAbortedError('장비 설정 변경이 취소되었습니다.', { cause: error })
    }
  }

  /** ConfigurationResult를 외부 변경이 불가능한 객체로 만든다. */
  #result(
    status: ConfigurationStatus,
    previousContext: DeviceContext,
    currentContext: DeviceContext | null,
    error?: Error,
    failedStepId?: string,
  ): ConfigurationResult {
    return Object.freeze({ status, previousContext, currentContext, error, failedStepId })
  }

  /** unknown catch 값을 Error로 정규화한다. */
  #toError(error: unknown): Error {
    return error instanceof Error ? error : new Error(String(error))
  }
}
