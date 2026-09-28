'use strict'

const RecipeKind = Object.freeze({ Measurement: 'measurement', Configuration: 'configuration' })
const SerialParity = Object.freeze({ None: 'none', Even: 'even', Odd: 'odd' })
const SerialFlowControl = Object.freeze({ None: 'none', Hardware: 'hardware' })
const RecipeApplyMode = Object.freeze({ Immediate: 'immediate', AfterPowerCycle: 'after-power-cycle' })
const RecipeStepType = Object.freeze({
  ReadHoldingRegisters: 'readHoldingRegisters', WriteSingleRegister: 'writeSingleRegister',
  Delay: 'delay', ReopenSerial: 'reopenSerial', AssertEquals: 'assertEquals',
})
const RecipeRegisterEncodingType = Object.freeze({ Signed16: 'int16' })
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
    ...(bundle.profile.recipes.actions || []),
  ].filter((id) => id !== undefined)
  for (const recipeId of references) {
    if (!recipesById.has(recipeId)) issues.push({ path: '/profile/recipes', message: `존재하지 않는 Recipe를 참조합니다: ${recipeId}` })
  }
  const validateConfigurationChangeRecipe = (referenceName) => {
    const recipeId = bundle.profile.recipes[referenceName]
    if (!recipeId) return
    const recipeIndex = bundle.recipes.findIndex(({ id }) => id === recipeId)
    const recipe = recipesById.get(recipeId)
    if (!recipe) return
    if (recipe.kind !== RecipeKind.Configuration) issues.push({ path: `/profile/recipes/${referenceName}`, message: `표준 설정 변경은 configuration Recipe여야 합니다: ${recipeId}` })
    if (!recipe.steps.some(({ type }) => type === RecipeStepType.WriteSingleRegister)) issues.push({ path: `/recipes/${recipeIndex}/steps`, message: `표준 설정 변경에는 writeSingleRegister Step이 필요합니다: ${recipeId}` })
    const forbiddenStep = recipe.steps.find(({ type }) => [RecipeStepType.ReadHoldingRegisters, RecipeStepType.ReopenSerial, RecipeStepType.AssertEquals].includes(type))
    if (forbiddenStep) issues.push({ path: `/recipes/${recipeIndex}/steps`, message: `표준 설정 변경 Recipe는 쓰기 후 연결·검증 Step을 포함할 수 없습니다: ${forbiddenStep.id}` })
  }
  validateConfigurationChangeRecipe('changeSlaveId')
  validateConfigurationChangeRecipe('changeBaudRate')
  for (const actionId of (bundle.profile.recipes.actions || [])) {
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
      if (!hasRead || hasWrite || !(action.outputs && action.outputs.length)) {
        issues.push({ path: '/profile/recipes/actions', message: `조회 추가 작업은 읽기 Step과 output이 있고 쓰기 Step이 없는 measurement Recipe여야 합니다: ${actionId}` })
      }
      continue
    }
    if (action.kind === RecipeKind.Configuration && !hasWrite) {
      issues.push({ path: '/profile/recipes/actions', message: `추가 작업에는 writeSingleRegister Step이 필요합니다: ${actionId}` })
    }
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

module.exports = { RecipeKind, SerialParity, SerialFlowControl, RecipeApplyMode, RecipeStepType, RecipeRegisterEncodingType, RecipeSchemaVersion, RecipeDecoderType, STANDARD_DEVICE_ID_PARAMETER, validateCatalogBundleReferences }
