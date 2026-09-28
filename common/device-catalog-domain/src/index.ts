/** 브라우저와 서버에 모두 공개해도 되는 장비 카탈로그 계약만 이 package에서 내보낸다. */

export enum DeviceProfileSchemaVersion { Version1 = '1.0' }
export enum RecipeSchemaVersion { Version1 = '1.0', Version2 = '2.0' }
export enum CatalogBundleSchemaVersion { Version1 = '1.0' }
export enum SerialParity { None = 'none', Even = 'even', Odd = 'odd' }
export enum SerialFlowControl { None = 'none', Hardware = 'hardware' }
export enum RecipeKind { Measurement = 'measurement', Configuration = 'configuration' }
/** @deprecated 표준 설정 변경은 적용 방식과 무관하게 사용자 전원 재인가와 수동 재연결로 확인한다. */
export enum RecipeApplyMode { Immediate = 'immediate', AfterPowerCycle = 'after-power-cycle' }
export enum RecipeStepType {
  ReadHoldingRegisters = 'readHoldingRegisters', WriteSingleRegister = 'writeSingleRegister',
  Delay = 'delay', ReopenSerial = 'reopenSerial', AssertEquals = 'assertEquals',
}
/** 사람이 입력한 signed 값을 Modbus register의 unsigned 16-bit wire 값으로 바꾸는 제한된 인코딩 목록이다. */
export enum RecipeRegisterEncodingType { Signed16 = 'int16' }
/** Modbus register 배열을 의미 값으로 해석하는, 실행 엔진이 보장하는 기본 decoder 목록이다. */
export enum RecipeDecoderType {
  Unsigned16 = 'uint16', Signed16 = 'int16', Unsigned32 = 'uint32', Signed32 = 'int32',
  Float32 = 'float32', Float64 = 'float64', Bit = 'bit', Ascii = 'ascii', Hex = 'hex',
}
export enum RecipeRegisterOrder { HighWordFirst = 'high-word-first', LowWordFirst = 'low-word-first' }
export enum RecipeRegisterByteOrder { HighByteFirst = 'high-byte-first', LowByteFirst = 'low-byte-first' }
export enum RecipeStringTrim { None = 'none', Null = 'null', NullAndSpace = 'null-and-space' }
export enum RecipeFormatterType { Number = 'number', Text = 'text', Boolean = 'boolean', Enum = 'enum', Custom = 'custom' }
export enum RecipeErrorPolicy { Stop = 'stop' }

export const STANDARD_DEVICE_ID_PARAMETER = 'deviceId'

export interface SerialConfig {
  readonly baudRate: number
  readonly dataBits: 7 | 8
  readonly stopBits: 1 | 2
  readonly parity: SerialParity
  readonly flowControl: SerialFlowControl
}

export interface DeviceRecipeReferences {
  readonly measurements?: ReadonlyArray<string>
  readonly changeSlaveId?: string
  readonly changeBaudRate?: string
  /** 관리자가 장비 연결 화면에 일회성 조회·설정 작업으로 공개한 Recipe ID 목록이다. */
  readonly actions?: ReadonlyArray<string>
}

export interface CatalogCapabilityExtension {
  readonly capability: string
  readonly adapterId: string
}

export interface DeviceProfile {
  readonly schemaVersion: DeviceProfileSchemaVersion
  readonly id: string
  readonly manufacturer: string
  readonly model: string
  readonly serial: { readonly default: SerialConfig; readonly supportedBaudRates: ReadonlyArray<number> }
  readonly slave: { readonly defaultId: number; readonly minId: number; readonly maxId: number }
  readonly recipes: DeviceRecipeReferences
  readonly maps?: Readonly<Record<string, Readonly<Record<string, number>>>>
  readonly extensions?: ReadonlyArray<CatalogCapabilityExtension>
}

export interface DeviceProfileSummary {
  readonly id: string
  readonly manufacturer: string
  readonly model: string
}

export type RecipeValue = number | string | RecipeMapLookup
export interface RecipeMapLookup { readonly map: string; readonly key: string }
interface RecipeParameterBase { readonly name: string; readonly label?: string }
export interface IntegerRecipeParameter extends RecipeParameterBase { readonly type: 'integer'; readonly minimum: number; readonly maximum: number }
export interface EnumRecipeParameter extends RecipeParameterBase { readonly type: 'enum'; readonly values: ReadonlyArray<string | number> }
export type RecipeParameter = IntegerRecipeParameter | EnumRecipeParameter
interface RecipeStepBase { readonly id: string; readonly type: RecipeStepType }
export interface ReadHoldingRegistersStep extends RecipeStepBase { readonly type: RecipeStepType.ReadHoldingRegisters; readonly slaveId: RecipeValue; readonly address: number; readonly count: number; readonly saveAs: string }
export interface WriteSingleRegisterStep extends RecipeStepBase {
  readonly type: RecipeStepType.WriteSingleRegister
  readonly slaveId: RecipeValue
  readonly address: number
  readonly value: RecipeValue
  readonly encode?: { readonly type: RecipeRegisterEncodingType.Signed16 }
}
export interface DelayStep extends RecipeStepBase { readonly type: RecipeStepType.Delay; readonly milliseconds: number }
export interface ReopenSerialStep extends RecipeStepBase { readonly type: RecipeStepType.ReopenSerial; readonly baudRate: RecipeValue }
export interface AssertEqualsStep extends RecipeStepBase { readonly type: RecipeStepType.AssertEquals; readonly actual: string; readonly expected: RecipeValue }
export type RecipeStep = ReadHoldingRegistersStep | WriteSingleRegisterStep | DelayStep | ReopenSerialStep | AssertEqualsStep
/** v1 Catalog을 읽기 위한 호환 계약이며 신규 Catalog 작성에는 RecipeOutputV2를 사용한다. */
export interface LegacyRecipeOutput { readonly name: string; readonly source: string; readonly decoder: RecipeDecoderType.Unsigned16 | RecipeDecoderType.Signed16; readonly scale?: number; readonly offset?: number; readonly unit?: string }
export interface RecipeOutputSource { readonly variable: string; readonly start: number; readonly count: number }
interface RecipeDecoderBase { readonly type: RecipeDecoderType; readonly registerOrder?: RecipeRegisterOrder; readonly byteOrder?: RecipeRegisterByteOrder }
export interface Numeric16RecipeDecoder { readonly type: RecipeDecoderType.Unsigned16 | RecipeDecoderType.Signed16 }
export interface MultiRegisterNumericRecipeDecoder extends RecipeDecoderBase { readonly type: RecipeDecoderType.Unsigned32 | RecipeDecoderType.Signed32 | RecipeDecoderType.Float32 | RecipeDecoderType.Float64 }
export interface BitRecipeDecoder extends RecipeDecoderBase { readonly type: RecipeDecoderType.Bit; readonly bitIndex: number }
export interface AsciiRecipeDecoder extends RecipeDecoderBase { readonly type: RecipeDecoderType.Ascii; readonly trim?: RecipeStringTrim }
export interface HexRecipeDecoder extends RecipeDecoderBase { readonly type: RecipeDecoderType.Hex }
export type RecipeDecoder = Numeric16RecipeDecoder | MultiRegisterNumericRecipeDecoder | BitRecipeDecoder | AsciiRecipeDecoder | HexRecipeDecoder
export interface RecipeNumericTransform { readonly scale?: number; readonly offset?: number }
export interface NumberRecipeFormat { readonly type: RecipeFormatterType.Number; readonly fractionDigits?: number; readonly unit?: string }
export interface TextRecipeFormat { readonly type: RecipeFormatterType.Text }
export interface BooleanRecipeFormat { readonly type: RecipeFormatterType.Boolean; readonly trueLabel?: string; readonly falseLabel?: string }
export interface EnumRecipeFormat { readonly type: RecipeFormatterType.Enum; readonly values: Readonly<Record<string, string>> }
export interface CustomRecipeFormat { readonly type: RecipeFormatterType.Custom; readonly formatterId: string; readonly options?: Readonly<Record<string, string | number | boolean>> }
export type RecipeFormat = NumberRecipeFormat | TextRecipeFormat | BooleanRecipeFormat | EnumRecipeFormat | CustomRecipeFormat
export interface RecipeOutputV2 { readonly name: string; readonly source: RecipeOutputSource; readonly decode: RecipeDecoder; readonly transform?: RecipeNumericTransform; readonly format: RecipeFormat }
export type RecipeOutput = LegacyRecipeOutput | RecipeOutputV2
export interface Recipe { readonly schemaVersion: RecipeSchemaVersion; readonly id: string; readonly name: string; readonly kind: RecipeKind; readonly applyMode?: RecipeApplyMode; readonly parameters?: ReadonlyArray<RecipeParameter>; readonly steps: ReadonlyArray<RecipeStep>; readonly outputs?: ReadonlyArray<RecipeOutput>; readonly onError: RecipeErrorPolicy }

export interface CatalogBundle {
  readonly bundleVersion: CatalogBundleSchemaVersion
  readonly profile: DeviceProfile
  readonly recipes: ReadonlyArray<Recipe>
}

export interface CatalogValidationIssue { readonly path: string; readonly message: string }

/** Schema 검증 뒤 Profile과 Recipe 사이의 의미 관계를 검사한다. */
export function validateCatalogBundleReferences(bundle: CatalogBundle): ReadonlyArray<CatalogValidationIssue> {
  const issues: CatalogValidationIssue[] = []
  const recipesById = new Map<string, Recipe>()
  for (const recipe of bundle.recipes) {
    if (recipesById.has(recipe.id)) issues.push({ path: '/recipes', message: `Recipe ID가 중복되었습니다: ${recipe.id}` })
    recipesById.set(recipe.id, recipe)
  }

  const references = [
    ...(bundle.profile.recipes.measurements ?? []),
    bundle.profile.recipes.changeSlaveId,
    bundle.profile.recipes.changeBaudRate,
    ...(bundle.profile.recipes.actions ?? []),
  ].filter((id): id is string => id !== undefined)
  for (const recipeId of references) {
    if (!recipesById.has(recipeId)) issues.push({ path: '/profile/recipes', message: `존재하지 않는 Recipe를 참조합니다: ${recipeId}` })
  }

  /** 표준 설정 변경은 쓰기 뒤 연결을 종료하므로 Recipe 안에서 재접속하거나 적용값을 읽지 못하게 한다. */
  const validateConfigurationChangeRecipe = (referenceName: 'changeSlaveId' | 'changeBaudRate'): void => {
    const recipeId = bundle.profile.recipes[referenceName]
    if (!recipeId) return
    const recipeIndex = bundle.recipes.findIndex(({ id }) => id === recipeId)
    const recipe = recipesById.get(recipeId)
    if (!recipe) return
    if (recipe.kind !== RecipeKind.Configuration) {
      issues.push({ path: `/profile/recipes/${referenceName}`, message: `표준 설정 변경은 configuration Recipe여야 합니다: ${recipeId}` })
    }
    if (!recipe.steps.some(({ type }) => type === RecipeStepType.WriteSingleRegister)) {
      issues.push({ path: `/recipes/${recipeIndex}/steps`, message: `표준 설정 변경에는 writeSingleRegister Step이 필요합니다: ${recipeId}` })
    }
    const forbiddenStep = recipe.steps.find(({ type }) => [
      RecipeStepType.ReadHoldingRegisters,
      RecipeStepType.ReopenSerial,
      RecipeStepType.AssertEquals,
    ].includes(type))
    if (forbiddenStep) {
      issues.push({ path: `/recipes/${recipeIndex}/steps`, message: `표준 설정 변경 Recipe는 쓰기 후 연결·검증 Step을 포함할 수 없습니다: ${forbiddenStep.id}` })
    }
  }
  validateConfigurationChangeRecipe('changeSlaveId')
  validateConfigurationChangeRecipe('changeBaudRate')

  for (const [recipeIndex, recipe] of bundle.recipes.entries()) {
    if (recipe.applyMode === RecipeApplyMode.AfterPowerCycle && recipe.kind !== RecipeKind.Configuration) {
      issues.push({ path: `/recipes/${recipeIndex}/applyMode`, message: '전원 재인가 적용 방식은 설정 Recipe에만 사용할 수 있습니다.' })
    }
    for (const [outputIndex, output] of (recipe.outputs ?? []).entries()) {
      const usesLegacyShape = 'decoder' in output
      if ((recipe.schemaVersion === RecipeSchemaVersion.Version1) !== usesLegacyShape) {
        issues.push({ path: `/recipes/${recipeIndex}/outputs/${outputIndex}`, message: `Recipe ${recipe.schemaVersion} output 형식과 일치해야 합니다.` })
      }
      if ('decode' in output && output.transform && ![
        RecipeDecoderType.Unsigned16, RecipeDecoderType.Signed16, RecipeDecoderType.Unsigned32,
        RecipeDecoderType.Signed32, RecipeDecoderType.Float32, RecipeDecoderType.Float64,
      ].includes(output.decode.type)) {
        issues.push({ path: `/recipes/${recipeIndex}/outputs/${outputIndex}/transform`, message: 'scale/offset은 숫자 decoder에만 사용할 수 있습니다.' })
      }
      if ('decode' in output) {
        const requiredCounts: Partial<Record<RecipeDecoderType, number>> = {
          [RecipeDecoderType.Unsigned16]: 1, [RecipeDecoderType.Signed16]: 1, [RecipeDecoderType.Bit]: 1,
          [RecipeDecoderType.Unsigned32]: 2, [RecipeDecoderType.Signed32]: 2, [RecipeDecoderType.Float32]: 2,
          [RecipeDecoderType.Float64]: 4,
        }
        const requiredCount = requiredCounts[output.decode.type]
        if (requiredCount !== undefined && output.source.count !== requiredCount) {
          issues.push({ path: `/recipes/${recipeIndex}/outputs/${outputIndex}/source/count`, message: `${output.decode.type} decoder에는 register ${requiredCount}개가 필요합니다.` })
        }
        const decodedKind = output.decode.type === RecipeDecoderType.Bit ? 'boolean'
          : [RecipeDecoderType.Ascii, RecipeDecoderType.Hex].includes(output.decode.type) ? 'string' : 'number'
        const compatible = output.format.type === RecipeFormatterType.Custom
          || output.format.type === RecipeFormatterType.Enum && decodedKind !== 'boolean'
          || output.format.type === RecipeFormatterType.Number && decodedKind === 'number'
          || output.format.type === RecipeFormatterType.Text && decodedKind === 'string'
          || output.format.type === RecipeFormatterType.Boolean && decodedKind === 'boolean'
        if (!compatible) issues.push({ path: `/recipes/${recipeIndex}/outputs/${outputIndex}/format`, message: 'decoder 결과 타입과 formatter 타입이 일치해야 합니다.' })
      }
    }
  }

  for (const actionId of bundle.profile.recipes.actions ?? []) {
    const action = recipesById.get(actionId)
    if (!action) continue
    const actionIndex = bundle.recipes.findIndex(({ id }) => id === actionId)
    if ([bundle.profile.recipes.changeSlaveId, bundle.profile.recipes.changeBaudRate].includes(actionId)) {
      issues.push({ path: '/profile/recipes/actions', message: `표준 통신 설정 변경 Recipe는 추가 작업으로 중복 공개할 수 없습니다: ${actionId}` })
    }
    if (action.steps.some(({ type }) => type === RecipeStepType.ReopenSerial)) {
      issues.push({ path: `/recipes/${actionIndex}/steps`, message: `추가 작업은 Serial 연결을 다시 열 수 없습니다: ${actionId}` })
    }
    const hasRead = action.steps.some(({ type }) => type === RecipeStepType.ReadHoldingRegisters)
    const hasWrite = action.steps.some(({ type }) => type === RecipeStepType.WriteSingleRegister)
    if (action.kind === RecipeKind.Measurement) {
      if (!hasRead || hasWrite || !(action.outputs?.length)) {
        issues.push({ path: '/profile/recipes/actions', message: `조회 추가 작업은 읽기 Step과 output이 있고 쓰기 Step이 없는 measurement Recipe여야 합니다: ${actionId}` })
      }
      continue
    }
    if (action.kind === RecipeKind.Configuration && !hasWrite) {
      issues.push({ path: '/profile/recipes/actions', message: `추가 작업에는 writeSingleRegister Step이 필요합니다: ${actionId}` })
    }
  }

  const extensionCapabilities = (bundle.profile.extensions ?? []).map(({ capability }) => capability)
  if (new Set(extensionCapabilities).size !== extensionCapabilities.length) issues.push({ path: '/profile/extensions', message: 'extension capability는 Profile 안에서 고유해야 합니다.' })
  return issues
}
