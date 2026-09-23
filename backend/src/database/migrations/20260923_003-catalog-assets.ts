import { Kysely, sql } from 'kysely'
import { Migration } from 'kysely/migration'
import { DatabaseSchema } from '../database.types'

/**
 * Catalog 참고 자료를 JSON 정의와 분리해 수명주기·검증 상태를 독립 관리한다.
 * 실제 파일 bytes는 Backend 전용 volume에 두고 DB에는 무작위 storage key와 metadata만 저장한다.
 */
export const catalogAssetsMigration: Migration = {
  async up(database: Kysely<DatabaseSchema>): Promise<void> {
    await database.schema.createTable('catalog_thumbnails')
      .addColumn('catalog_id', 'bigint', (column) => column.unsigned().primaryKey())
      .addColumn('storage_key', 'varchar(255)', (column) => column.notNull().unique())
      .addColumn('content_type', 'varchar(50)', (column) => column.notNull())
      .addColumn('byte_size', 'integer', (column) => column.unsigned().notNull())
      .addColumn('etag', 'char(64)', (column) => column.notNull())
      .addColumn('updated_by_user_id', 'bigint', (column) => column.unsigned().notNull())
      .addColumn('created_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
      .addColumn('updated_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`))
      .addForeignKeyConstraint('fk_catalog_thumbnails_catalog', ['catalog_id'], 'device_catalogs', ['id'], (constraint) => constraint.onDelete('cascade'))
      .addForeignKeyConstraint('fk_catalog_thumbnails_user', ['updated_by_user_id'], 'users', ['id'], (constraint) => constraint.onDelete('restrict'))
      .execute()

    await database.schema.createTable('catalog_files')
      .addColumn('id', 'bigint', (column) => column.unsigned().autoIncrement().primaryKey())
      .addColumn('catalog_id', 'bigint', (column) => column.unsigned().notNull())
      .addColumn('title', 'varchar(160)', (column) => column.notNull())
      .addColumn('document_type', sql`enum('communication_protocol','manual','datasheet','reference_image','other')`, (column) => column.notNull())
      .addColumn('original_name', 'varchar(255)', (column) => column.notNull())
      .addColumn('storage_key', 'varchar(255)', (column) => column.notNull().unique())
      .addColumn('content_type', 'varchar(100)', (column) => column.notNull())
      .addColumn('byte_size', 'integer', (column) => column.unsigned().notNull())
      .addColumn('sha256', 'char(64)', (column) => column.notNull())
      .addColumn('status', sql`enum('pending','clean','rejected','failed')`, (column) => column.notNull().defaultTo('pending'))
      .addColumn('rejection_code', 'varchar(80)')
      .addColumn('created_by_user_id', 'bigint', (column) => column.unsigned().notNull())
      .addColumn('created_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
      .addForeignKeyConstraint('fk_catalog_files_catalog', ['catalog_id'], 'device_catalogs', ['id'], (constraint) => constraint.onDelete('cascade'))
      .addForeignKeyConstraint('fk_catalog_files_user', ['created_by_user_id'], 'users', ['id'], (constraint) => constraint.onDelete('restrict'))
      .execute()
    await database.schema.createIndex('idx_catalog_files_catalog').on('catalog_files').column('catalog_id').execute()

    await database.schema.createTable('catalog_links')
      .addColumn('id', 'bigint', (column) => column.unsigned().autoIncrement().primaryKey())
      .addColumn('catalog_id', 'bigint', (column) => column.unsigned().notNull())
      .addColumn('title', 'varchar(160)', (column) => column.notNull())
      .addColumn('link_type', sql`enum('official_website','manufacturer_page','documentation','reference')`, (column) => column.notNull())
      .addColumn('url', 'varchar(2048)', (column) => column.notNull())
      .addColumn('created_by_user_id', 'bigint', (column) => column.unsigned().notNull())
      .addColumn('updated_by_user_id', 'bigint', (column) => column.unsigned().notNull())
      .addColumn('created_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
      .addColumn('updated_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`))
      .addForeignKeyConstraint('fk_catalog_links_catalog', ['catalog_id'], 'device_catalogs', ['id'], (constraint) => constraint.onDelete('cascade'))
      .addForeignKeyConstraint('fk_catalog_links_created_user', ['created_by_user_id'], 'users', ['id'], (constraint) => constraint.onDelete('restrict'))
      .addForeignKeyConstraint('fk_catalog_links_updated_user', ['updated_by_user_id'], 'users', ['id'], (constraint) => constraint.onDelete('restrict'))
      .execute()
    await database.schema.createIndex('idx_catalog_links_catalog').on('catalog_links').column('catalog_id').execute()
  },

  async down(database: Kysely<DatabaseSchema>): Promise<void> {
    await database.schema.dropTable('catalog_links').execute()
    await database.schema.dropTable('catalog_files').execute()
    await database.schema.dropTable('catalog_thumbnails').execute()
  },
}
