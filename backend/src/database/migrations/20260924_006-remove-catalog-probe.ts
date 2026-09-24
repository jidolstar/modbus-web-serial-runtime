import { Kysely, sql } from 'kysely'
import { Migration } from 'kysely/migration'
import type { DatabaseSchema } from '../database.types'

interface MutableJsonObject { [key: string]: unknown }

function asObject(value: unknown): MutableJsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as MutableJsonObject : null
}

/** 기존 Catalog의 나머지 사용자 정의는 보존하고 제거된 probe 구조만 읽기 확인 Step으로 변환한다. */
function removeLegacyProbe(rawDefinition: unknown): { definition: MutableJsonObject; changed: boolean } {
  const definition = asObject(typeof rawDefinition === 'string' ? JSON.parse(rawDefinition) : rawDefinition)
  if (!definition) throw new Error('Catalog definition_json must be a JSON object')
  const profile = asObject(definition.profile)
  const recipeReferences = asObject(profile?.recipes)
  const recipes = Array.isArray(definition.recipes) ? definition.recipes : null
  if (!profile || !recipeReferences || !recipes) throw new Error('Catalog definition_json has an invalid bundle shape')

  let changed = false
  if ('probe' in recipeReferences) {
    delete recipeReferences.probe
    changed = true
  }
  definition.recipes = recipes.flatMap((candidate) => {
    const recipe = asObject(candidate)
    if (!recipe) return [candidate]
    if (recipe.kind === 'probe') {
      changed = true
      return []
    }
    if (!Array.isArray(recipe.steps)) return [recipe]
    recipe.steps = recipe.steps.map((candidateStep) => {
      const step = asObject(candidateStep)
      if (!step || step.type !== 'probe') return candidateStep
      changed = true
      return {
        id: step.id,
        type: 'readHoldingRegisters',
        slaveId: step.slaveId,
        address: 0,
        count: 1,
        saveAs: 'verificationRegisters',
      }
    })
    return [recipe]
  })
  return { definition, changed }
}

/** Catalog v1에서 자동 식별 의미의 probe 계약을 제거하면서 기존 DB JSON을 새 Schema에 맞춘다. */
export const removeCatalogProbeMigration: Migration = {
  async up(database: Kysely<DatabaseSchema>): Promise<void> {
    const rows = await database.selectFrom('catalog').select(['id', 'definition_json']).execute()
    for (const row of rows) {
      const { definition, changed } = removeLegacyProbe(row.definition_json)
      if (!changed) continue
      await database.updateTable('catalog').set({
        definition_json: JSON.stringify(definition),
        revision: sql`revision + 1`,
        updated_at: new Date(),
      }).where('id', '=', row.id).execute()
    }
  },

  async down(): Promise<void> {
    // 제거된 사용자 Probe의 원문은 안전하게 복원할 수 없으므로 rollback에서 임의 JSON을 만들지 않는다.
  },
}
