import {
  RecipeFormatterType,
  RecipeStepType,
  type CatalogBundle,
  type RecipeFormat,
  type RecipeOutput,
} from '@modbus-manager/device-catalog-domain'
import { recipeOutputFormatterRegistry, type RecipeOutputFormatterRegistry } from '../../recipe-engine/recipe-output-formatter'

export interface CatalogRecipeSummary {
  readonly id: string // Catalog JSON과 대조할 Recipe ID. 예: "example-device.read"
  readonly name: string // 상세 화면에 표시하는 Recipe 이름
  readonly roles: ReadonlyArray<string> // Profile 참조가 부여한 사용 위치. 예: "주기 측정"
  readonly operations: ReadonlyArray<string> // 실제 Step에서 파생한 Modbus 방향. 예: "읽기 FC03"
  readonly results: ReadonlyArray<string> // output 이름·형식·단위 요약
  readonly supported: boolean // 모든 output formatter를 현재 Frontend가 처리할 수 있으면 true
}

function outputFormat(output: RecipeOutput): RecipeFormat {
  return 'format' in output
    ? output.format
    : { type: RecipeFormatterType.Number, unit: output.unit }
}

function resultLabel(output: RecipeOutput): string {
  const format = outputFormat(output)
  const formatLabel = format.type === RecipeFormatterType.Custom
    ? `custom:${format.formatterId}`
    : format.type
  const unit = format.type === RecipeFormatterType.Number && format.unit ? ` · ${format.unit}` : ''
  return `${output.name} · ${formatLabel}${unit}`
}

/** Catalog 상세에서 전체 Recipe의 노출 위치, 통신 방향과 결과 형식을 한 행으로 합친다. */
export function summarizeCatalogRecipes(
  bundle: CatalogBundle,
  registry: RecipeOutputFormatterRegistry = recipeOutputFormatterRegistry,
): ReadonlyArray<CatalogRecipeSummary> {
  const references = bundle.profile.recipes
  return Object.freeze(bundle.recipes.map((recipe) => {
    const roles: string[] = []
    if (references.measurements?.includes(recipe.id)) roles.push('주기 측정')
    if (references.changeSlaveId === recipe.id) roles.push('Slave ID 변경')
    if (references.changeBaudRate === recipe.id) roles.push('Baudrate 변경')
    if (references.actions?.includes(recipe.id)) roles.push('장비 연결 작업')
    if (!roles.length) roles.push('직접 노출 안 됨')

    const operations: string[] = []
    if (recipe.steps.some(({ type }) => type === RecipeStepType.ReadHoldingRegisters)) operations.push('읽기 FC03')
    if (recipe.steps.some(({ type }) => type === RecipeStepType.WriteSingleRegister)) operations.push('쓰기 FC06')
    if (!operations.length) operations.push('통신 없음')

    const outputs = recipe.outputs ?? []
    return Object.freeze({
      id: recipe.id,
      name: recipe.name,
      roles: Object.freeze(roles),
      operations: Object.freeze(operations),
      results: Object.freeze(outputs.map(resultLabel)),
      supported: outputs.every((output) => registry.supports(outputFormat(output))),
    })
  }))
}
