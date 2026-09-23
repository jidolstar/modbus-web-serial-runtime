import { Kysely, sql } from 'kysely'
import { Migration } from 'kysely/migration'
import { DatabaseSchema } from '../database.types'

/**
 * CatalogRepository가 사용할 장비 모델 정의 테이블을 만든다.
 * JSON 원문과 검색용 파생 열을 함께 보관해 JSON path 기반 검색에 의존하지 않게 한다.
 */
export const deviceCatalogsMigration: Migration = {
  async up(database: Kysely<DatabaseSchema>): Promise<void> {
    await database.schema
      .createTable('device_catalogs')
      .addColumn('id', 'bigint', (column) => column.unsigned().autoIncrement().primaryKey())
      .addColumn('catalog_key', 'varchar(100)', (column) => column.notNull().unique())
      .addColumn('title', 'varchar(160)', (column) => column.notNull())
      .addColumn('schema_version', 'varchar(20)', (column) => column.notNull())
      .addColumn('manufacturer', 'varchar(100)', (column) => column.notNull())
      .addColumn('model', 'varchar(100)', (column) => column.notNull())
      .addColumn('definition_json', 'json', (column) => column.notNull())
      .addColumn('revision', 'integer', (column) => column.unsigned().notNull().defaultTo(1))
      .addColumn('enabled', 'boolean', (column) => column.notNull().defaultTo(true))
      .addColumn('created_by_user_id', 'bigint', (column) => column.unsigned().notNull())
      .addColumn('updated_by_user_id', 'bigint', (column) => column.unsigned().notNull())
      .addColumn('created_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
      .addColumn('updated_at', 'datetime(3)', (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`),
      )
      .addForeignKeyConstraint('fk_device_catalogs_created_by', ['created_by_user_id'], 'users', ['id'], (constraint) => constraint.onDelete('restrict'))
      .addForeignKeyConstraint('fk_device_catalogs_updated_by', ['updated_by_user_id'], 'users', ['id'], (constraint) => constraint.onDelete('restrict'))
      .execute()

    await database.schema.createIndex('idx_device_catalogs_title').on('device_catalogs').column('title').execute()
    await database.schema.createIndex('idx_device_catalogs_enabled').on('device_catalogs').column('enabled').execute()
    await database.schema.createIndex('idx_device_catalogs_manufacturer_model').on('device_catalogs').columns(['manufacturer', 'model']).execute()
  },

  async down(database: Kysely<DatabaseSchema>): Promise<void> {
    await database.schema.dropTable('device_catalogs').execute()
  },
}
