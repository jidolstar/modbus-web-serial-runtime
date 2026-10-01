import { Injectable } from '@nestjs/common'
import Ajv, { type ErrorObject, type ValidateFunction } from 'ajv'
import {
  type CatalogBundle,
  STANDARD_MODBUS_BAUD_RATES,
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

function pointerSegment(value: string): string {
  return value.replaceAll('~', '~0').replaceAll('/', '~1')
}

const LOWERCASE_ID_PATTERN = '^[a-z0-9][a-z0-9._-]*$'
const RECIPE_OUTPUT_PATH = /^\/recipes\/(\d+)\/outputs\/(\d+)$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * AI가 만든 v2 output 하나의 오류에 legacy branch 진단이 섞였는지 판별한다.
 * 공용 Schema의 legacy 호환은 유지하고, 사용자에게 공개할 오류 목록에서만 관계없는 branch 오류를 제거한다.
 */
function isLegacyBranchErrorForV2Output(error: ErrorObject, candidate: unknown): boolean {
  const outputPath = error.instancePath.match(RECIPE_OUTPUT_PATH)?.[0]
    ?? error.instancePath.replace(/\/(name|source)(?:\/.*)?$/, '')
  const indexes = outputPath.match(RECIPE_OUTPUT_PATH)
  if (!indexes || !isRecord(candidate) || !Array.isArray(candidate.recipes)) return false
  const recipe = candidate.recipes[Number(indexes[1])]
  if (!isRecord(recipe) || !Array.isArray(recipe.outputs)) return false
  const output = recipe.outputs[Number(indexes[2])]
  if (!isRecord(output) || !isRecord(output.source) || !isRecord(output.decode)) return false

  if (error.instancePath === outputPath && error.keyword === 'required') {
    return error.params.missingProperty === 'decoder'
  }
  if (error.instancePath === outputPath && error.keyword === 'additionalProperties') {
    return ['decode', 'transform', 'format'].includes(String(error.params.additionalProperty))
  }
  return error.instancePath === `${outputPath}/source`
    && error.keyword === 'type'
    && error.params.type === 'string'
}

/** 구체적인 v2 하위 오류가 있으면 같은 output의 포괄적인 oneOf 오류는 중복 안내하지 않는다. */
function isRedundantOutputOneOfError(error: ErrorObject, errors: readonly ErrorObject[]): boolean {
  if (error.keyword !== 'oneOf' || !RECIPE_OUTPUT_PATH.test(error.instancePath)) return false
  return errors.some((candidate) => candidate !== error
    && (candidate.instancePath === error.instancePath || candidate.instancePath.startsWith(`${error.instancePath}/`))
    && candidate.keyword !== 'oneOf')
}

function relevantSchemaErrors(errors: readonly ErrorObject[], candidate: unknown): readonly ErrorObject[] {
  const withoutWrongBranch = errors.filter((error) => !isLegacyBranchErrorForV2Output(error, candidate))
  return withoutWrongBranch.filter((error) => !isRedundantOutputOneOfError(error, withoutWrongBranch))
}

/** AJV 내부 문구를 값이나 Schema 구현을 노출하지 않는 사용자용 검증 설명으로 바꾼다. */
function formatSchemaIssue(error: ErrorObject): { readonly path: string; readonly message: string } {
  if (error.keyword === 'required' && typeof error.params.missingProperty === 'string') {
    const property = error.params.missingProperty
    const parent = error.instancePath || ''
    return { path: `${parent}/${pointerSegment(property)}`, message: `필수 속성 '${property}'이(가) 없습니다.` }
  }
  if (error.keyword === 'additionalProperties' && typeof error.params.additionalProperty === 'string') {
    const property = error.params.additionalProperty
    return { path: error.instancePath || '/', message: `허용되지 않은 속성 '${property}'이(가) 있습니다.` }
  }
  if (error.keyword === 'enum' && Array.isArray(error.params.allowedValues)) {
    return { path: formatSchemaPath(error), message: `허용값 중 하나여야 합니다: ${error.params.allowedValues.join(', ')}` }
  }
  if (error.keyword === 'type' && typeof error.params.type === 'string') {
    return { path: formatSchemaPath(error), message: `값의 형식이 '${error.params.type}'이어야 합니다.` }
  }
  if (error.keyword === 'pattern' && error.params.pattern === LOWERCASE_ID_PATTERN) {
    return {
      path: formatSchemaPath(error),
      message: '영문 소문자 또는 숫자로 시작하고 영문 소문자, 숫자, 점(.), 밑줄(_), 하이픈(-)만 사용할 수 있습니다.',
    }
  }
  return { path: formatSchemaPath(error), message: 'CatalogBundle JSON 계약에 맞지 않는 값입니다.' }
}

function uniqueIssues(issues: readonly { readonly path: string; readonly message: string }[]): readonly { readonly path: string; readonly message: string }[] {
  return [...new Map(issues.map((issue) => [`${issue.path}\u0000${issue.message}`, issue])).values()]
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

  /** AI 검토 화면이 호출하며, 공개 가능한 경로와 해결 단서를 최대 20개까지 반환한다. */
  public inspect(candidate: unknown): readonly { readonly path: string; readonly message: string }[] {
    if (!this.#validateBundle(candidate)) {
      const errors = relevantSchemaErrors(this.#validateBundle.errors ?? [], candidate)
      return uniqueIssues(errors.map(formatSchemaIssue)).slice(0, 20)
    }

    const issues = [...validateCatalogBundleReferences(candidate)]
    const { profile, recipes } = candidate
    if (profile.slave.minId > profile.slave.maxId
      || profile.slave.defaultId < profile.slave.minId
      || profile.slave.defaultId > profile.slave.maxId) {
      issues.push({ path: '/profile/slave', message: 'defaultId는 minId와 maxId 범위 안에 있어야 합니다.' })
    }
    if (!profile.serial.supportedBaudRates.includes(profile.serial.default.baudRate)) {
      issues.push({ path: '/profile/serial/default/baudRate', message: '기본 baudrate는 supportedBaudRates에 포함되어야 합니다.' })
    }
    const allowedBaudRates = new Set<number>(STANDARD_MODBUS_BAUD_RATES)
    if (profile.serial.supportedBaudRates.some((baudRate) => !allowedBaudRates.has(baudRate))) {
      issues.push({ path: '/profile/serial/supportedBaudRates', message: `시스템 지원 baudrate만 사용할 수 있습니다: ${STANDARD_MODBUS_BAUD_RATES.join(', ')}` })
    }
    const baudRecipe = recipes.find(({ id }) => id === profile.recipes.changeBaudRate)
    const targetBaud = baudRecipe?.parameters?.find(({ name }) => name === 'targetBaud')
    if (targetBaud && (targetBaud.type !== 'enum' || JSON.stringify(targetBaud.values) !== JSON.stringify(profile.serial.supportedBaudRates))) {
      issues.push({
        path: '/profile/recipes/changeBaudRate',
        message: `changeBaudRate Recipe의 targetBaud enum은 supportedBaudRates와 순서까지 같아야 합니다: ${profile.serial.supportedBaudRates.join(', ')}`,
      })
    }
    for (const [recipeIndex, recipe] of recipes.entries()) {
      const stepIds = recipe.steps.map(({ id }) => id)
      const parameterNames = (recipe.parameters ?? []).map(({ name }) => name)
      const outputNames = (recipe.outputs ?? []).map(({ name }) => name)
      if (new Set(stepIds).size !== stepIds.length
        || new Set(parameterNames).size !== parameterNames.length
        || new Set(outputNames).size !== outputNames.length) {
        issues.push({ path: `/recipes/${recipeIndex}`, message: 'Step ID, parameter 이름과 output 이름은 각 Recipe 안에서 중복될 수 없습니다.' })
      }
      const invalidParameter = (recipe.parameters ?? []).find(
        (parameter) => parameter.type === 'integer' && parameter.minimum > parameter.maximum,
      )
      if (invalidParameter) {
        issues.push({ path: `/recipes/${recipeIndex}/parameters`, message: `정수 parameter '${invalidParameter.name}'의 minimum은 maximum보다 클 수 없습니다.` })
      }
      for (const [stepIndex, step] of recipe.steps.entries()) {
        if (step.type !== 'writeSingleRegister' || typeof step.value !== 'object') continue
        const parameterName = /^\$\{([^}]+)\}$/.exec(step.value.key)?.[1]
        const parameter = recipe.parameters?.find(({ name }) => name === parameterName)
        const valueMap = profile.maps?.[step.value.map]
        if (parameter?.type !== 'enum' || !valueMap) continue
        const missingKeys = parameter.values.map(String).filter((value) => valueMap[value] === undefined)
        if (missingKeys.length > 0) {
          issues.push({
            path: `/recipes/${recipeIndex}/steps/${stepIndex}/value/map`,
            message: `map '${step.value.map}'에 enum 값의 register 코드가 없습니다: ${missingKeys.join(', ')}`,
          })
        }
      }
    }
    return uniqueIssues(issues).slice(0, 20)
  }

  /** 등록·검증·수정 API가 사용하며, 공개 상세는 fields 계약으로 축약해 기존 client 호환성을 유지한다. */
  public validate(candidate: unknown): CatalogBundle {
    const issues = this.inspect(candidate)
    if (issues.length > 0) {
      throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, [...new Set(issues.map(({ path }) => path))])
    }
    return candidate as CatalogBundle
  }
}
