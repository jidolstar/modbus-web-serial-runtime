import type { CatalogBundle } from '@modbus-manager/device-catalog-domain'
import { parseApiBaseUrl } from '../http/api-base-url'
import { DeviceCatalogEntryNotFoundError, DeviceCatalogError, DeviceCatalogValidationError } from './catalog-errors'
import type { DeviceCatalog } from './catalog.types'
import type { DeviceProfile, DeviceProfileSummary } from './device-profile.types'
import { DeviceProfileValidator } from './device-profile-validator'
import type { Recipe } from './recipe.types'

type CatalogFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * DynamicDeviceRuntime가 Backend의 활성 Catalog snapshot을 실행용 Map으로 변환할 때 사용한다.
 * 응답 전체의 Schema·참조·중복을 검증한 후에만 기존 Map을 교체해 부분 갱신을 노출하지 않는다.
 */
export class ApiDeviceCatalog implements DeviceCatalog {
  readonly #profiles = new Map<string, DeviceProfile>()
  readonly #recipes = new Map<string, Recipe>()
  readonly #endpoint: string
  #loaded = false

  public constructor(
    rawApiBaseUrl: string | undefined = import.meta.env.VITE_API_BASE_URL,
    private readonly validator = new DeviceProfileValidator(),
    private readonly catalogFetch: CatalogFetch = (input, init) => fetch(input, init),
  ) {
    this.#endpoint = new URL('runtime/catalog', parseApiBaseUrl(rawApiBaseUrl)).toString()
  }

  /** 앱 초기화에서 호출해 활성 snapshot을 검증하고 불변 Profile·Recipe Map으로 원자 교체한다. */
  public async load(): Promise<void> {
    let response: Response
    try {
      response = await this.catalogFetch(this.#endpoint, { credentials: 'include', headers: { Accept: 'application/json' } })
    } catch (error) {
      throw new DeviceCatalogError('Runtime Catalog 요청에 실패했습니다.', { cause: error })
    }
    if (!response.ok) throw new DeviceCatalogError(`Runtime Catalog를 불러오지 못했습니다. (HTTP ${response.status})`)

    const candidate: unknown = await response.json().catch((error: unknown) => {
      throw new DeviceCatalogError('Runtime Catalog 응답 JSON을 해석할 수 없습니다.', { cause: error })
    })
    if (!this.#isSnapshot(candidate)) throw new DeviceCatalogValidationError('Runtime Catalog 응답 형식이 올바르지 않습니다.')

    const bundles = candidate.items.map((item, index) => {
      const bundle = this.validator.validateCatalogBundle(item.definition, `runtime/items/${index}/definition`)
      if (bundle.profile.id !== item.catalogKey) throw new DeviceCatalogValidationError(`runtime/items/${index}/catalogKey: Profile ID와 일치해야 합니다.`)
      return bundle
    })
    const profiles = new Map<string, DeviceProfile>()
    const recipes = new Map<string, Recipe>()
    for (const bundle of bundles) this.#appendBundle(bundle, profiles, recipes)

    this.#profiles.clear(); this.#recipes.clear()
    for (const [id, profile] of profiles) this.#profiles.set(id, this.#deepFreeze(profile))
    for (const [id, recipe] of recipes) this.#recipes.set(id, this.#deepFreeze(recipe))
    this.#loaded = true
  }

  public getProfile(profileId: string): DeviceProfile {
    this.#assertLoaded()
    const profile = this.#profiles.get(profileId)
    if (!profile) throw new DeviceCatalogEntryNotFoundError(`Device Profile을 찾을 수 없습니다: ${profileId}`)
    return profile
  }

  public getRecipe(recipeId: string): Recipe {
    this.#assertLoaded()
    const recipe = this.#recipes.get(recipeId)
    if (!recipe) throw new DeviceCatalogEntryNotFoundError(`Recipe를 찾을 수 없습니다: ${recipeId}`)
    return recipe
  }

  public listProfiles(): ReadonlyArray<DeviceProfileSummary> {
    this.#assertLoaded()
    return Object.freeze([...this.#profiles.values()].map(({ id, manufacturer, model }) => Object.freeze({ id, manufacturer, model })))
  }

  #appendBundle(bundle: CatalogBundle, profiles: Map<string, DeviceProfile>, recipes: Map<string, Recipe>): void {
    if (profiles.has(bundle.profile.id)) throw new DeviceCatalogValidationError(`Profile ID가 중복되었습니다: ${bundle.profile.id}`)
    profiles.set(bundle.profile.id, bundle.profile)
    for (const recipe of bundle.recipes) {
      if (recipes.has(recipe.id)) throw new DeviceCatalogValidationError(`Recipe ID가 중복되었습니다: ${recipe.id}`)
      recipes.set(recipe.id, recipe)
    }
  }

  #isSnapshot(value: unknown): value is { readonly items: ReadonlyArray<{ readonly catalogKey: string; readonly revision: number; readonly definition: unknown }> } {
    return typeof value === 'object' && value !== null && 'items' in value && Array.isArray(value.items)
      && value.items.every((item) => typeof item === 'object' && item !== null
        && 'catalogKey' in item && typeof item.catalogKey === 'string'
        && 'revision' in item && Number.isInteger(item.revision) && Number(item.revision) >= 1
        && 'definition' in item)
  }

  #assertLoaded(): void {
    if (!this.#loaded) throw new DeviceCatalogError('Device Catalog를 먼저 load()해야 합니다.')
  }

  #deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const nested of Object.values(value)) this.#deepFreeze(nested)
      Object.freeze(value)
    }
    return value
  }
}
