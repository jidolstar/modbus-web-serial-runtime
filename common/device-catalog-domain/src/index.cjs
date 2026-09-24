'use strict'

const RecipeKind = Object.freeze({ Measurement: 'measurement', Configuration: 'configuration' })
const RecipeStepType = Object.freeze({ ReadHoldingRegisters: 'readHoldingRegisters', AssertEquals: 'assertEquals' })
const STANDARD_DEVICE_ID_PARAMETER = 'deviceId'

/** Backend 런타임이 저장 전 Profile–Recipe 참조 무결성을 검사할 때 사용하는 CommonJS 진입점이다. */
function validateCatalogBundleReferences(bundle) {
  const issues = []
  const recipesById = new Map()
  for (const recipe of bundle.recipes) {
    if (recipesById.has(recipe.id)) issues.push({ path: '/recipes', message: `Recipe ID가 중복되었습니다: ${recipe.id}` })
    recipesById.set(recipe.id, recipe)
  }
  const references = [
    ...(bundle.profile.recipes.measurements || []),
    bundle.profile.recipes.changeSlaveId,
    bundle.profile.recipes.changeBaudRate,
  ].filter((id) => id !== undefined)
  for (const recipeId of references) {
    if (!recipesById.has(recipeId)) issues.push({ path: '/profile/recipes', message: `존재하지 않는 Recipe를 참조합니다: ${recipeId}` })
  }
  const extensionCapabilities = (bundle.profile.extensions || []).map(({ capability }) => capability)
  if (new Set(extensionCapabilities).size !== extensionCapabilities.length) issues.push({ path: '/profile/extensions', message: 'extension capability는 Profile 안에서 고유해야 합니다.' })
  return issues
}

module.exports = { RecipeKind, RecipeStepType, STANDARD_DEVICE_ID_PARAMETER, validateCatalogBundleReferences }
