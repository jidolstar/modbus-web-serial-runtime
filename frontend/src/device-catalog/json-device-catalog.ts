import {
  DeviceCatalogEntryNotFoundError,
  DeviceCatalogError,
  DeviceCatalogValidationError,
} from './catalog-errors'
import type { DeviceCatalog, DeviceCatalogIndex } from './catalog.types'
import type { DeviceProfile, DeviceProfileSummary } from './device-profile.types'
import { DeviceProfileValidator } from './device-profile-validator'
import type { Recipe } from './recipe.types'

/** 테스트에서 browser fetch를 대체할 수 있도록 분리한 최소 fetch 함수 타입이다. */
export type CatalogFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/**
 * 정적 HTTP 경로에서 Profile/Recipe JSON을 읽는 Runtime Catalog다.
 *
 * 향후 Backend Catalog도 같은 DeviceCatalog 인터페이스를 구현하므로 상위 계층은
 * 파일 제공 방식과 API 제공 방식을 구분하지 않는다.
 */
export class JsonDeviceCatalog implements DeviceCatalog {
  readonly #profiles = new Map<string, DeviceProfile>()
  readonly #recipes = new Map<string, Recipe>()
  #loaded = false

  public constructor(
    private readonly baseUrl = '/device-catalog/',
    private readonly validator = new DeviceProfileValidator(),
    private readonly catalogFetch: CatalogFetch = (input, init) => fetch(input, init),
  ) {}

  /** index와 모든 참조 JSON을 검증한 뒤 한 번에 Catalog로 교체한다. */
  public async load(): Promise<void> {
    const normalizedBaseUrl = this.baseUrl.endsWith('/') ? this.baseUrl : `${this.baseUrl}/`
    const indexUrl = `${normalizedBaseUrl}index.json`
    const indexCandidate = await this.#fetchJson(indexUrl)
    const catalogIndex = this.validator.validateCatalogIndex(indexCandidate, indexUrl)

    const loadedProfiles = await this.#loadProfiles(normalizedBaseUrl, catalogIndex)
    const loadedRecipes = await this.#loadRecipes(normalizedBaseUrl, catalogIndex)
    this.#validateReferences(loadedProfiles, loadedRecipes)

    // 일부 파일만 갱신된 상태를 노출하지 않도록 전체 검증 성공 후 기존 Map을 교체한다.
    this.#profiles.clear()
    this.#recipes.clear()
    for (const profile of loadedProfiles) this.#profiles.set(profile.id, this.#deepFreeze(profile))
    for (const recipe of loadedRecipes) this.#recipes.set(recipe.id, this.#deepFreeze(recipe))
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
    return Object.freeze([...this.#profiles.values()].map((profile) => Object.freeze({
      id: profile.id,
      manufacturer: profile.manufacturer,
      model: profile.model,
    })))
  }

  /** index에 나열된 Profile을 병렬로 읽고 중복 ID를 차단한다. */
  async #loadProfiles(baseUrl: string, index: DeviceCatalogIndex): Promise<DeviceProfile[]> {
    const profiles = await Promise.all(index.profiles.map(async (relativePath) => {
      const sourceUrl = `${baseUrl}${relativePath}`
      return this.validator.validateDeviceProfile(await this.#fetchJson(sourceUrl), sourceUrl)
    }))
    this.#assertUniqueIds(profiles, 'Device Profile')
    return profiles
  }

  /** index에 나열된 Recipe를 병렬로 읽고 중복 ID를 차단한다. */
  async #loadRecipes(baseUrl: string, index: DeviceCatalogIndex): Promise<Recipe[]> {
    const recipes = await Promise.all(index.recipes.map(async (relativePath) => {
      const sourceUrl = `${baseUrl}${relativePath}`
      return this.validator.validateRecipe(await this.#fetchJson(sourceUrl), sourceUrl)
    }))
    this.#assertUniqueIds(recipes, 'Recipe')
    return recipes
  }

  /** Profile의 Recipe 참조가 모두 로드됐는지 전체 Catalog 관점에서 검증한다. */
  #validateReferences(profiles: DeviceProfile[], recipes: Recipe[]): void {
    const recipesById = new Map(recipes.map((recipe) => [recipe.id, recipe]))

    for (const profile of profiles) {
      const referencedRecipeIds = [
        ...(profile.recipes.measurements ?? []),
        profile.recipes.changeSlaveId,
        profile.recipes.changeBaudRate,
      ].filter((recipeId): recipeId is string => recipeId !== undefined)

      for (const recipeId of referencedRecipeIds) {
        if (!recipesById.has(recipeId)) {
          throw new DeviceCatalogValidationError(
            `Profile ${profile.id}이(가) 존재하지 않는 Recipe를 참조합니다: ${recipeId}`,
          )
        }
      }
    }
  }

  /** HTTP 오류와 JSON parsing 오류를 Catalog 문맥이 포함된 오류로 변환한다. */
  async #fetchJson(sourceUrl: string): Promise<unknown> {
    let response: Response
    try {
      response = await this.catalogFetch(sourceUrl)
    } catch (error) {
      throw new DeviceCatalogError(`Catalog 파일 요청에 실패했습니다: ${sourceUrl}`, { cause: error })
    }

    if (!response.ok) {
      throw new DeviceCatalogError(
        `Catalog 파일을 불러오지 못했습니다: ${sourceUrl} (HTTP ${response.status})`,
      )
    }

    try {
      return await response.json()
    } catch (error) {
      throw new DeviceCatalogError(`Catalog JSON을 해석할 수 없습니다: ${sourceUrl}`, { cause: error })
    }
  }

  /** 같은 종류의 entry가 동일 ID로 덮어써지는 상황을 차단한다. */
  #assertUniqueIds(entries: ReadonlyArray<{ readonly id: string }>, entryType: string): void {
    const observedIds = new Set<string>()
    for (const entry of entries) {
      if (observedIds.has(entry.id)) {
        throw new DeviceCatalogValidationError(`${entryType} ID가 중복되었습니다: ${entry.id}`)
      }
      observedIds.add(entry.id)
    }
  }

  /** load() 전에 조회 API가 호출되는 프로그래밍 오류를 명확히 알린다. */
  #assertLoaded(): void {
    if (!this.#loaded) throw new DeviceCatalogError('Device Catalog를 먼저 load()해야 합니다.')
  }

  /** JSON object 전체를 재귀적으로 freeze해 Catalog 외부 변경을 막는다. */
  #deepFreeze<T>(value: T): T {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const nestedValue of Object.values(value)) this.#deepFreeze(nestedValue)
      Object.freeze(value)
    }
    return value
  }
}
