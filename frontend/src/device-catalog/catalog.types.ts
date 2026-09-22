import type { DeviceProfile, DeviceProfileSummary } from './device-profile.types'
import type { Recipe } from './recipe.types'

/** Catalog index JSON 형식의 현재 버전이다. */
export enum CatalogSchemaVersion {
  Version1 = '1.0',
}

/** Runtime Catalog가 불러올 Profile/Recipe 상대 경로 목록이다. */
export interface DeviceCatalogIndex {
  readonly schemaVersion: CatalogSchemaVersion
  readonly profiles: ReadonlyArray<string>
  readonly recipes: ReadonlyArray<string>
}

/** Profile/Recipe 저장 위치와 무관하게 상위 계층이 사용하는 Catalog 계약이다. */
export interface DeviceCatalog {
  load(): Promise<void>
  getProfile(profileId: string): DeviceProfile
  getRecipe(recipeId: string): Recipe
  listProfiles(): ReadonlyArray<DeviceProfileSummary>
}
