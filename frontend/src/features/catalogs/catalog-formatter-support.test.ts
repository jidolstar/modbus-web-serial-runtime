import { RecipeFormatterType, type CatalogBundle } from '@modbus-manager/device-catalog-domain'
import cwtBundle from '../../../../common/device-catalog-domain/examples/cwt-th04s.bundle.json'
import { describe, expect, it } from 'vitest'
import { RecipeOutputFormatterRegistry } from '../../recipe-engine/recipe-output-formatter'
import { summarizeCatalogFormatters } from './catalog-formatter-support'

describe('summarizeCatalogFormatters', () => {
  it('같은 기본 formatter를 합치고 현재 배포본 지원 상태를 표시한다', () => {
    const summaries = summarizeCatalogFormatters(cwtBundle as CatalogBundle)
    expect(summaries).toEqual([{ key: 'number', label: 'number', recipeNames: ['CWT-TH04S 온습도 읽기'], supported: true }])
  })

  it('등록되지 않은 custom formatter와 사전 등록된 formatter를 구분한다', () => {
    const bundle = structuredClone(cwtBundle) as unknown as CatalogBundle
    const measurement = bundle.recipes.find((recipe) => recipe.outputs?.length)
    if (!measurement || !measurement.outputs || !('format' in measurement.outputs[0])) throw new Error('v2 output fixture가 필요합니다.')
    const customBundle = {
      ...bundle,
      recipes: bundle.recipes.map((recipe) => recipe.id === measurement.id
        ? { ...recipe, outputs: [{ ...measurement.outputs![0], format: { type: RecipeFormatterType.Custom, formatterId: 'example-v1' } }] }
        : recipe),
    } as CatalogBundle
    const registry = new RecipeOutputFormatterRegistry()

    expect(summarizeCatalogFormatters(customBundle, registry)[0]?.supported).toBe(false)
    registry.register('example-v1', (value) => ({ text: String(value) }))
    expect(summarizeCatalogFormatters(customBundle, registry)[0]?.supported).toBe(true)
  })
})
