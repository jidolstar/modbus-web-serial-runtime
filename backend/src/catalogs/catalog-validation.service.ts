import { Injectable } from '@nestjs/common'
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import {
  type CatalogBundle,
  validateCatalogBundleReferences,
} from '@modbus-manager/device-catalog-domain'
import catalogBundleSchema = require('@modbus-manager/device-catalog-domain/schemas/catalog-bundle.schema.json')
import deviceProfileSchema = require('@modbus-manager/device-catalog-domain/schemas/device-profile.schema.json')
import recipeSchema = require('@modbus-manager/device-catalog-domain/schemas/recipe.schema.json')
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'

function formatSchemaPath(error: ErrorObject): string {
  return error.instancePath || '/'
}

/**
 * CatalogService가 DB 저장 전에 호출하는 서버측 Bundle 검증 경계다.
 * 공용 JSON Schema와 의미 검증 함수에 의존하며, 검증된 객체만 저장 계층으로 전달한다.
 */
@Injectable()
export class CatalogValidationService {
  readonly #validateBundle: ValidateFunction<CatalogBundle> // 요청마다 Schema를 다시 compile하지 않도록 재사용하는 AJV 함수

  public constructor() {
    const ajv = new Ajv({ allErrors: true, strict: true })
    ajv.addSchema(deviceProfileSchema)
    ajv.addSchema(recipeSchema)
    this.#validateBundle = ajv.compile<CatalogBundle>(catalogBundleSchema)
  }

  /** 등록·검증·수정 API가 사용하며, 실패 위치만 공개하고 내부 validator 상세는 숨긴다. */
  public validate(candidate: unknown): CatalogBundle {
    if (!this.#validateBundle(candidate)) {
      const fields = [...new Set((this.#validateBundle.errors ?? []).map(formatSchemaPath))].slice(0, 20)
      throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, fields)
    }

    const referenceIssues = validateCatalogBundleReferences(candidate)
    if (referenceIssues.length > 0) {
      throw new CatalogError(
        CATALOG_ERROR_CODES.invalidInput,
        400,
        [...new Set(referenceIssues.map(({ path }) => path))].slice(0, 20),
      )
    }

    const { profile, recipes } = candidate
    if (profile.slave.minId > profile.slave.maxId
      || profile.slave.defaultId < profile.slave.minId
      || profile.slave.defaultId > profile.slave.maxId) {
      throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['/profile/slave'])
    }
    if (!profile.serial.supportedBaudRates.includes(profile.serial.default.baudRate)) {
      throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['/profile/serial/default/baudRate'])
    }
    for (const [recipeIndex, recipe] of recipes.entries()) {
      const stepIds = recipe.steps.map(({ id }) => id)
      const parameterNames = (recipe.parameters ?? []).map(({ name }) => name)
      const outputNames = (recipe.outputs ?? []).map(({ name }) => name)
      if (new Set(stepIds).size !== stepIds.length
        || new Set(parameterNames).size !== parameterNames.length
        || new Set(outputNames).size !== outputNames.length) {
        throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, [`/recipes/${recipeIndex}`])
      }
      const invalidParameter = (recipe.parameters ?? []).find(
        (parameter) => parameter.type === 'integer' && parameter.minimum > parameter.maximum,
      )
      if (invalidParameter) {
        throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, [`/recipes/${recipeIndex}/parameters`])
      }
    }
    return candidate
  }
}
