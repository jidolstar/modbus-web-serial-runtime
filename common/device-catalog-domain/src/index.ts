/** 브라우저와 서버에 모두 공개해도 되는 장비 카탈로그 계약만 이 package에서 내보낸다. */

export enum DeviceProfileSchemaVersion { Version1 = '1.0' }
export enum RecipeSchemaVersion { Version1 = '1.0' }
export enum CatalogBundleSchemaVersion { Version1 = '1.0' }
export enum SerialParity { None = 'none', Even = 'even', Odd = 'odd' }
export enum SerialFlowControl { None = 'none', Hardware = 'hardware' }
export enum RecipeKind { Measurement = 'measurement', Configuration = 'configuration' }
export enum RecipeStepType {
  ReadHoldingRegisters = 'readHoldingRegisters', WriteSingleRegister = 'writeSingleRegister',
  Delay = 'delay', ReopenSerial = 'reopenSerial', AssertEquals = 'assertEquals',
}
export enum RecipeDecoderType { Unsigned16 = 'uint16', Signed16 = 'int16' }
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
export interface WriteSingleRegisterStep extends RecipeStepBase { readonly type: RecipeStepType.WriteSingleRegister; readonly slaveId: RecipeValue; readonly address: number; readonly value: RecipeValue }
export interface DelayStep extends RecipeStepBase { readonly type: RecipeStepType.Delay; readonly milliseconds: number }
export interface ReopenSerialStep extends RecipeStepBase { readonly type: RecipeStepType.ReopenSerial; readonly baudRate: RecipeValue }
export interface AssertEqualsStep extends RecipeStepBase { readonly type: RecipeStepType.AssertEquals; readonly actual: string; readonly expected: RecipeValue }
export type RecipeStep = ReadHoldingRegistersStep | WriteSingleRegisterStep | DelayStep | ReopenSerialStep | AssertEqualsStep
export interface RecipeOutput { readonly name: string; readonly source: string; readonly decoder: RecipeDecoderType; readonly scale?: number; readonly offset?: number; readonly unit?: string }
export interface Recipe { readonly schemaVersion: RecipeSchemaVersion; readonly id: string; readonly name: string; readonly kind: RecipeKind; readonly parameters?: ReadonlyArray<RecipeParameter>; readonly steps: ReadonlyArray<RecipeStep>; readonly outputs?: ReadonlyArray<RecipeOutput>; readonly onError: RecipeErrorPolicy }

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
  ].filter((id): id is string => id !== undefined)
  for (const recipeId of references) {
    if (!recipesById.has(recipeId)) issues.push({ path: '/profile/recipes', message: `존재하지 않는 Recipe를 참조합니다: ${recipeId}` })
  }

  const extensionCapabilities = (bundle.profile.extensions ?? []).map(({ capability }) => capability)
  if (new Set(extensionCapabilities).size !== extensionCapabilities.length) issues.push({ path: '/profile/extensions', message: 'extension capability는 Profile 안에서 고유해야 합니다.' })
  return issues
}
