import { Kysely } from 'kysely'
import { Migration } from 'kysely/migration'
import { DatabaseSchema, TestGroupNodesTable } from '../database.types'

type LegacyDatabaseSchema = Omit<DatabaseSchema, 'test_group_nodes'> & {
  test_group_nodes: Omit<TestGroupNodesTable, 'catalog_revision'> & { catalog_revision: number }
}

/** Test Group node가 현재 Catalog를 사용하므로 중복 보관하던 Catalog revision 컬럼을 제거한다. */
export const removeTestGroupNodeCatalogRevisionMigration: Migration = {
  async up(database: Kysely<DatabaseSchema>): Promise<void> {
    await database.schema.alterTable('test_group_nodes')
      .dropColumn('catalog_revision')
      .execute()
  },
  async down(database: Kysely<LegacyDatabaseSchema>): Promise<void> {
    await database.schema.alterTable('test_group_nodes')
      .addColumn('catalog_revision', 'integer', (column) => column.unsigned().notNull().defaultTo(1))
      .execute()

    // 복구 시 이력 값은 없으므로 구 코드가 동작하도록 연결된 현재 Catalog revision을 채운다.
    await database.updateTable('test_group_nodes')
      .set((expression) => ({
        catalog_revision: expression.selectFrom('catalog')
          .select('revision')
          .whereRef('catalog.id', '=', 'test_group_nodes.catalog_id'),
      }))
      .execute()
  },
}
