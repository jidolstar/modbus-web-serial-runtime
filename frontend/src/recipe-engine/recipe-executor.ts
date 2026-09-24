import type { DeviceCatalog } from '../device-catalog/catalog.types'
import type { DeviceProfile } from '../device-catalog/device-profile.types'
import {
  RecipeStepType,
  type Recipe,
  type RecipeParameter,
  type RecipeStep,
} from '../device-catalog/recipe.types'
import type { ModbusClient } from '../modbus/modbus-types'
import type { SerialTransport } from '../serial/serial-transport'
import type { SerialConfig } from '../serial/serial-types'
import { RecipeAbortedError, RecipeExecutionError } from './recipe-execution-errors'
import { RecipeOutputDecoder } from './recipe-output-decoder'
import {
  RecipeExecutionStatus,
  RecipeStepExecutionStatus,
  type RecipeContextValue,
  type RecipeExecutionResult,
  type RecipeNamedOutput,
  type RecipeRunner,
  type RecipeStepResult,
} from './recipe-execution.types'
import { RecipeValueResolver } from './recipe-value-resolver'

/** Step handler가 공유하는 한 번의 Recipe 실행 상태다. */
interface RecipeExecutionContext {
  readonly profile: DeviceProfile
  readonly recipe: Recipe
  readonly values: Map<string, RecipeContextValue>
  readonly signal?: AbortSignal
}

/** enum으로 제한된 Step을 수행하는 private handler 함수 계약이다. */
type RecipeStepHandler = (step: RecipeStep, context: RecipeExecutionContext) => Promise<void>

/**
 * 검증된 Profile/Recipe를 허용된 Step만으로 실행한다.
 *
 * handler map과 실행 context는 외부에 공개하지 않으며, JSON에서 함수 이름이나
 * JavaScript 코드를 주입할 수 없도록 enum 값에 대응하는 handler만 등록한다.
 */
export class RecipeExecutor implements RecipeRunner {
  readonly #valueResolver = new RecipeValueResolver()
  readonly #outputDecoder = new RecipeOutputDecoder()
  readonly #stepHandlers: ReadonlyMap<RecipeStepType, RecipeStepHandler>

  public constructor(
    private readonly catalog: DeviceCatalog,
    private readonly modbusClient: ModbusClient,
    private readonly serialTransport: SerialTransport,
  ) {
    this.#stepHandlers = new Map<RecipeStepType, RecipeStepHandler>([
      [RecipeStepType.ReadHoldingRegisters, (step, context) => this.#readHoldingRegisters(step, context)],
      [RecipeStepType.WriteSingleRegister, (step, context) => this.#writeSingleRegister(step, context)],
      [RecipeStepType.Delay, (step, context) => this.#delay(step, context)],
      [RecipeStepType.ReopenSerial, (step, context) => this.#reopenSerial(step, context)],
      [RecipeStepType.AssertEquals, (step, context) => this.#assertEquals(step, context)],
    ])
  }

  public async execute(
    profileId: string,
    recipeId: string,
    parameters: Readonly<Record<string, unknown>> = {},
    signal?: AbortSignal,
  ): Promise<RecipeExecutionResult> {
    const profile = this.catalog.getProfile(profileId)
    const recipe = this.catalog.getRecipe(recipeId)
    const values = this.#validateParameters(recipe, parameters)
    const context: RecipeExecutionContext = { profile, recipe, values, signal }
    const stepResults = await this.#executeSteps(context)
    const outputs = this.#decodeOutputs(recipe, values)

    return Object.freeze({
      recipeId: recipe.id,
      status: RecipeExecutionStatus.Succeeded,
      steps: Object.freeze(stepResults),
      outputs: Object.freeze(outputs),
      context: Object.freeze(Object.fromEntries(values)),
    })
  }

  /** parameter 누락, 초과 입력, type/range 오류를 통신 전에 모두 검사한다. */
  #validateParameters(
    recipe: Recipe,
    suppliedParameters: Readonly<Record<string, unknown>>,
  ): Map<string, RecipeContextValue> {
    const declaredParameters = new Map((recipe.parameters ?? []).map((item) => [item.name, item]))
    for (const suppliedName of Object.keys(suppliedParameters)) {
      if (!declaredParameters.has(suppliedName)) {
        throw new RecipeExecutionError(`정의되지 않은 parameter입니다: ${suppliedName}`, recipe.id)
      }
    }

    const validatedValues = new Map<string, RecipeContextValue>()
    for (const parameter of recipe.parameters ?? []) {
      if (!(parameter.name in suppliedParameters)) {
        throw new RecipeExecutionError(`필수 parameter가 없습니다: ${parameter.name}`, recipe.id)
      }
      const suppliedValue = suppliedParameters[parameter.name]
      this.#validateParameterValue(recipe.id, parameter, suppliedValue)
      validatedValues.set(parameter.name, suppliedValue as number | string)
    }
    return validatedValues
  }

  /** parameter 선언 종류에 맞춰 정수 범위 또는 enum 포함 여부를 확인한다. */
  #validateParameterValue(recipeId: string, parameter: RecipeParameter, value: unknown): void {
    if (parameter.type === 'integer') {
      if (!Number.isInteger(value)
        || (value as number) < parameter.minimum
        || (value as number) > parameter.maximum) {
        throw new RecipeExecutionError(
          `parameter '${parameter.name}'은(는) ${parameter.minimum}~${parameter.maximum} 정수여야 합니다.`,
          recipeId,
        )
      }
      return
    }

    if (!parameter.values.some((allowedValue) => allowedValue === value)) {
      throw new RecipeExecutionError(
        `parameter '${parameter.name}'은(는) 허용된 enum 값이어야 합니다.`,
        recipeId,
      )
    }
  }

  /** Step을 순서대로 수행하고 성공/실패 시간을 구조화해 기록한다. */
  async #executeSteps(context: RecipeExecutionContext): Promise<RecipeStepResult[]> {
    const results: RecipeStepResult[] = []
    for (const step of context.recipe.steps) {
      this.#throwIfAborted(context.recipe.id, step.id, results, context.signal)
      const startedAt = new Date()
      try {
        const handler = this.#stepHandlers.get(step.type)
        if (!handler) throw new RecipeExecutionError(`지원하지 않는 Step입니다: ${String(step.type)}`, context.recipe.id, step.id)
        await handler(step, context)
        this.#throwIfAborted(context.recipe.id, step.id, results, context.signal)
        results.push(Object.freeze({
          stepId: step.id,
          status: RecipeStepExecutionStatus.Succeeded,
          startedAt,
          finishedAt: new Date(),
        }))
      } catch (error) {
        const failedResult = Object.freeze({
          stepId: step.id,
          status: RecipeStepExecutionStatus.Failed,
          startedAt,
          finishedAt: new Date(),
          errorMessage: error instanceof Error ? error.message : String(error),
        })
        const completedSteps = Object.freeze([...results, failedResult])
        if (error instanceof RecipeAbortedError || context.signal?.aborted) {
          throw new RecipeAbortedError(context.recipe.id, step.id, completedSteps, { cause: error })
        }
        throw new RecipeExecutionError(
          `Recipe Step '${step.id}' 실행에 실패했습니다.`,
          context.recipe.id,
          step.id,
          completedSteps,
          { cause: error },
        )
      }
    }
    return results
  }

  async #readHoldingRegisters(step: RecipeStep, context: RecipeExecutionContext): Promise<void> {
    if (step.type !== RecipeStepType.ReadHoldingRegisters) return this.#wrongHandler(step, context.recipe.id)
    const slaveId = this.#valueResolver.resolveNumber(step.slaveId, context.values, context.profile, context.recipe.id)
    const registers = await this.modbusClient.readHoldingRegisters(slaveId, step.address, step.count)
    context.values.set(step.saveAs, Object.freeze([...registers]))
  }

  async #writeSingleRegister(step: RecipeStep, context: RecipeExecutionContext): Promise<void> {
    if (step.type !== RecipeStepType.WriteSingleRegister) return this.#wrongHandler(step, context.recipe.id)
    const slaveId = this.#valueResolver.resolveNumber(step.slaveId, context.values, context.profile, context.recipe.id)
    const value = this.#valueResolver.resolveNumber(step.value, context.values, context.profile, context.recipe.id)
    await this.modbusClient.writeSingleRegister(slaveId, step.address, value)
  }

  async #delay(step: RecipeStep, context: RecipeExecutionContext): Promise<void> {
    if (step.type !== RecipeStepType.Delay) return this.#wrongHandler(step, context.recipe.id)
    await new Promise<void>((resolve, reject) => {
      const finishDelay = () => {
        context.signal?.removeEventListener('abort', handleAbort)
        resolve()
      }
      const timeoutId = globalThis.setTimeout(finishDelay, step.milliseconds)
      const handleAbort = () => {
        globalThis.clearTimeout(timeoutId)
        context.signal?.removeEventListener('abort', handleAbort)
        reject(new RecipeAbortedError(context.recipe.id, step.id))
      }
      if (context.signal?.aborted) return handleAbort()
      context.signal?.addEventListener('abort', handleAbort, { once: true })
    })
  }

  async #reopenSerial(step: RecipeStep, context: RecipeExecutionContext): Promise<void> {
    if (step.type !== RecipeStepType.ReopenSerial) return this.#wrongHandler(step, context.recipe.id)
    const baudRate = this.#valueResolver.resolveNumber(step.baudRate, context.values, context.profile, context.recipe.id)
    const serialConfig: SerialConfig = Object.freeze({ ...context.profile.serial.default, baudRate })
    await this.serialTransport.reopen(serialConfig)
  }

  async #assertEquals(step: RecipeStep, context: RecipeExecutionContext): Promise<void> {
    if (step.type !== RecipeStepType.AssertEquals) return this.#wrongHandler(step, context.recipe.id)
    const actualValue = this.#resolveActualValue(step.actual, context.values, context.recipe.id)
    const expectedValue = this.#valueResolver.resolveNumber(step.expected, context.values, context.profile, context.recipe.id)
    if (actualValue !== expectedValue) {
      throw new RecipeExecutionError(`검증값이 다릅니다. expected=${expectedValue}, actual=${actualValue}`, context.recipe.id, step.id)
    }
  }

  /** assertEquals의 `name` 또는 `name[index]`만 읽고 임의 path 접근을 차단한다. */
  #resolveActualValue(
    reference: string,
    values: ReadonlyMap<string, RecipeContextValue>,
    recipeId: string,
  ): number {
    const match = /^([A-Za-z][A-Za-z0-9_]*)(?:\[([0-9]+)\])?$/.exec(reference)
    if (!match) throw new RecipeExecutionError(`잘못된 검증 참조입니다: ${reference}`, recipeId)
    const contextValue = values.get(match[1])
    const resolvedValue = match[2] === undefined
      ? contextValue
      : (Array.isArray(contextValue) ? contextValue[Number(match[2])] : undefined)
    if (typeof resolvedValue !== 'number') {
      throw new RecipeExecutionError(`숫자 검증값을 찾을 수 없습니다: ${reference}`, recipeId)
    }
    return resolvedValue
  }

  /** Recipe output 선언 전체를 이름 기반 불변 객체로 만든다. */
  #decodeOutputs(
    recipe: Recipe,
    values: ReadonlyMap<string, RecipeContextValue>,
  ): Record<string, RecipeNamedOutput> {
    const outputs: Record<string, RecipeNamedOutput> = {}
    for (const output of recipe.outputs ?? []) {
      outputs[output.name] = this.#outputDecoder.decode(output, values, recipe.id)
    }
    return outputs
  }

  /** 이미 취소된 실행은 다음 I/O나 Step으로 넘어가지 않게 한다. */
  #throwIfAborted(
    recipeId: string,
    stepId: string,
    results: ReadonlyArray<RecipeStepResult>,
    signal?: AbortSignal,
  ): void {
    if (signal?.aborted) throw new RecipeAbortedError(recipeId, stepId, results, { cause: signal.reason })
  }

  /** handler map과 실제 discriminated union이 어긋나는 프로그래밍 오류를 표시한다. */
  #wrongHandler(step: RecipeStep, recipeId: string): never {
    throw new RecipeExecutionError(`Step handler 연결이 올바르지 않습니다: ${step.type}`, recipeId, step.id)
  }
}
