'use strict'

const RecipeKind = Object.freeze({ Measurement: 'measurement', Configuration: 'configuration' })
const RecipeApplyMode = Object.freeze({ Immediate: 'immediate', AfterPowerCycle: 'after-power-cycle' })
const RecipeStepType = Object.freeze({ ReadHoldingRegisters: 'readHoldingRegisters', AssertEquals: 'assertEquals' })
const RecipeSchemaVersion = Object.freeze({ Version1: '1.0', Version2: '2.0' })
const RecipeDecoderType = Object.freeze({ Unsigned16: 'uint16', Signed16: 'int16', Unsigned32: 'uint32', Signed32: 'int32', Float32: 'float32', Float64: 'float64', Bit: 'bit', Ascii: 'ascii', Hex: 'hex' })
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
  for (const [recipeIndex, recipe] of bundle.recipes.entries()) {
    if (recipe.applyMode === RecipeApplyMode.AfterPowerCycle && recipe.kind !== RecipeKind.Configuration) {
      issues.push({ path: `/recipes/${recipeIndex}/applyMode`, message: '전원 재인가 적용 방식은 설정 Recipe에만 사용할 수 있습니다.' })
    }
    for (const [outputIndex, output] of (recipe.outputs || []).entries()) {
      const usesLegacyShape = Object.prototype.hasOwnProperty.call(output, 'decoder')
      if ((recipe.schemaVersion === RecipeSchemaVersion.Version1) !== usesLegacyShape) issues.push({ path: `/recipes/${recipeIndex}/outputs/${outputIndex}`, message: `Recipe ${recipe.schemaVersion} output 형식과 일치해야 합니다.` })
      const numericTypes = [RecipeDecoderType.Unsigned16, RecipeDecoderType.Signed16, RecipeDecoderType.Unsigned32, RecipeDecoderType.Signed32, RecipeDecoderType.Float32, RecipeDecoderType.Float64]
      if (output.decode && output.transform && !numericTypes.includes(output.decode.type)) issues.push({ path: `/recipes/${recipeIndex}/outputs/${outputIndex}/transform`, message: 'scale/offset은 숫자 decoder에만 사용할 수 있습니다.' })
      if (output.decode) {
        const requiredCounts = { uint16: 1, int16: 1, bit: 1, uint32: 2, int32: 2, float32: 2, float64: 4 }
        const requiredCount = requiredCounts[output.decode.type]
        if (requiredCount !== undefined && output.source.count !== requiredCount) issues.push({ path: `/recipes/${recipeIndex}/outputs/${outputIndex}/source/count`, message: `${output.decode.type} decoder에는 register ${requiredCount}개가 필요합니다.` })
        const decodedKind = output.decode.type === 'bit' ? 'boolean' : ['ascii', 'hex'].includes(output.decode.type) ? 'string' : 'number'
        const formatType = output.format.type
        const compatible = formatType === 'custom' || (formatType === 'enum' && decodedKind !== 'boolean') || (formatType === 'number' && decodedKind === 'number') || (formatType === 'text' && decodedKind === 'string') || (formatType === 'boolean' && decodedKind === 'boolean')
        if (!compatible) issues.push({ path: `/recipes/${recipeIndex}/outputs/${outputIndex}/format`, message: 'decoder 결과 타입과 formatter 타입이 일치해야 합니다.' })
      }
    }
  }
  const extensionCapabilities = (bundle.profile.extensions || []).map(({ capability }) => capability)
  if (new Set(extensionCapabilities).size !== extensionCapabilities.length) issues.push({ path: '/profile/extensions', message: 'extension capability는 Profile 안에서 고유해야 합니다.' })
  return issues
}

module.exports = { RecipeKind, RecipeApplyMode, RecipeStepType, RecipeSchemaVersion, RecipeDecoderType, STANDARD_DEVICE_ID_PARAMETER, validateCatalogBundleReferences }
