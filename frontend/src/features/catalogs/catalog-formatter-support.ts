import { RecipeFormatterType, type CatalogBundle, type RecipeFormat } from '@modbus-manager/device-catalog-domain'
import { recipeOutputFormatterRegistry, type RecipeOutputFormatterRegistry } from '../../recipe-engine/recipe-output-formatter'

export interface CatalogFormatterSummary {
  readonly key: string // 같은 formatter 선언을 합치는 안정 key. 예: "custom:example-v1"
  readonly label: string // 관리 화면에 표시할 형식명 또는 사전 배포 formatter ID
  readonly recipeNames: ReadonlyArray<string> // 해당 formatter를 사용하는 Recipe 표시 이름
  readonly supported: boolean // 현재 Frontend 배포본에서 실행 가능하면 true다.
}

/** Catalog 상세 화면에서 Recipe output의 formatter 선언과 현재 배포본 지원 여부를 요약한다. */
export function summarizeCatalogFormatters(
  bundle: CatalogBundle,
  registry: RecipeOutputFormatterRegistry = recipeOutputFormatterRegistry,
): ReadonlyArray<CatalogFormatterSummary> {
  const summaries = new Map<string, { format: RecipeFormat; recipeNames: Set<string> }>()
  for (const recipe of bundle.recipes) {
    for (const output of recipe.outputs ?? []) {
      const format: RecipeFormat = 'format' in output
        ? output.format
        : { type: RecipeFormatterType.Number, unit: output.unit }
      const key = format.type === RecipeFormatterType.Custom
        ? `${format.type}:${format.formatterId}`
        : format.type
      const summary = summaries.get(key) ?? { format, recipeNames: new Set<string>() }
      summary.recipeNames.add(recipe.name)
      summaries.set(key, summary)
    }
  }

  return Object.freeze([...summaries.entries()].map(([key, { format, recipeNames }]) => Object.freeze({
    key,
    label: format.type === RecipeFormatterType.Custom ? `custom · ${format.formatterId}` : format.type,
    recipeNames: Object.freeze([...recipeNames]),
    supported: registry.supports(format),
  })))
}
