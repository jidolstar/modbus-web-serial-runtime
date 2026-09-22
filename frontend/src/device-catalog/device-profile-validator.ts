import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import catalogIndexSchema from './schemas/catalog-index.schema.json'
import deviceProfileSchema from './schemas/device-profile.schema.json'
import recipeSchema from './schemas/recipe.schema.json'
import { DeviceCatalogValidationError } from './catalog-errors'
import type { DeviceCatalogIndex } from './catalog.types'
import type { DeviceProfile } from './device-profile.types'
import type { Recipe } from './recipe.types'

/** JSON Schema 오류를 사람이 수정할 수 있는 한 줄 설명으로 변환한다. */
function formatSchemaErrors(sourceName: string, errors: ErrorObject[] | null | undefined): string {
  const formattedErrors = (errors ?? []).map((error) => {
    const errorPath = error.instancePath || '/'
    return `${sourceName}${errorPath}: ${error.message ?? '알 수 없는 Schema 오류'}`
  })
  return formattedErrors.join('; ')
}

/**
 * 외부 JSON을 애플리케이션 타입으로 사용하기 전에 구조와 기본 의미를 검증한다.
 *
 * TypeScript type assertion만으로는 런타임 JSON의 안전성을 보장할 수 없으므로,
 * Catalog는 반드시 이 validator를 통과한 값만 저장한다.
 */
export class DeviceProfileValidator {
  readonly #validateCatalogIndex: ValidateFunction<DeviceCatalogIndex>
  readonly #validateDeviceProfile: ValidateFunction<DeviceProfile>
  readonly #validateRecipe: ValidateFunction<Recipe>

  public constructor() {
    const ajv = new Ajv({ allErrors: true, strict: true })
    this.#validateCatalogIndex = ajv.compile<DeviceCatalogIndex>(catalogIndexSchema)
    this.#validateDeviceProfile = ajv.compile<DeviceProfile>(deviceProfileSchema)
    this.#validateRecipe = ajv.compile<Recipe>(recipeSchema)
  }

  /** Catalog index JSON을 검증하고 안전한 타입으로 반환한다. */
  public validateCatalogIndex(candidate: unknown, sourceName: string): DeviceCatalogIndex {
    if (!this.#validateCatalogIndex(candidate)) {
      throw new DeviceCatalogValidationError(
        formatSchemaErrors(sourceName, this.#validateCatalogIndex.errors),
      )
    }
    return candidate
  }

  /** Device Profile의 Schema와 내부 범위 관계를 검증한다. */
  public validateDeviceProfile(candidate: unknown, sourceName: string): DeviceProfile {
    if (!this.#validateDeviceProfile(candidate)) {
      throw new DeviceCatalogValidationError(
        formatSchemaErrors(sourceName, this.#validateDeviceProfile.errors),
      )
    }

    if (candidate.slave.minId > candidate.slave.maxId) {
      throw new DeviceCatalogValidationError(`${sourceName}/slave: minId가 maxId보다 클 수 없습니다.`)
    }
    if (candidate.slave.defaultId < candidate.slave.minId
      || candidate.slave.defaultId > candidate.slave.maxId) {
      throw new DeviceCatalogValidationError(
        `${sourceName}/slave/defaultId: minId~maxId 범위 안에 있어야 합니다.`,
      )
    }
    if (!candidate.serial.supportedBaudRates.includes(candidate.serial.default.baudRate)) {
      throw new DeviceCatalogValidationError(
        `${sourceName}/serial/default/baudRate: supportedBaudRates에 포함되어야 합니다.`,
      )
    }

    return candidate
  }

  /** Recipe Schema와 중복 식별자, parameter 범위를 검증한다. */
  public validateRecipe(candidate: unknown, sourceName: string): Recipe {
    if (!this.#validateRecipe(candidate)) {
      throw new DeviceCatalogValidationError(
        formatSchemaErrors(sourceName, this.#validateRecipe.errors),
      )
    }

    const stepIds = candidate.steps.map((step) => step.id)
    if (new Set(stepIds).size !== stepIds.length) {
      throw new DeviceCatalogValidationError(`${sourceName}/steps: Step id는 Recipe 안에서 고유해야 합니다.`)
    }

    const parameterNames = (candidate.parameters ?? []).map((parameter) => parameter.name)
    if (new Set(parameterNames).size !== parameterNames.length) {
      throw new DeviceCatalogValidationError(
        `${sourceName}/parameters: parameter name은 Recipe 안에서 고유해야 합니다.`,
      )
    }
    for (const parameter of candidate.parameters ?? []) {
      if (parameter.type === 'integer' && parameter.minimum > parameter.maximum) {
        throw new DeviceCatalogValidationError(
          `${sourceName}/parameters/${parameter.name}: minimum이 maximum보다 클 수 없습니다.`,
        )
      }
    }

    const outputNames = (candidate.outputs ?? []).map((output) => output.name)
    if (new Set(outputNames).size !== outputNames.length) {
      throw new DeviceCatalogValidationError(
        `${sourceName}/outputs: output name은 Recipe 안에서 고유해야 합니다.`,
      )
    }

    return candidate
  }
}
