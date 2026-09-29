import { Kysely, sql } from 'kysely'
import { Migration } from 'kysely/migration'
import { DatabaseSchema } from '../database.types'

/** AI Catalog 호출을 사용자 email snapshot과 함께 추적하는 provider 중립 감사 table을 추가한다. */
export const catalogAiRequestsMigration: Migration = {
  async up(database: Kysely<DatabaseSchema>): Promise<void> {
    await database.schema.createTable('catalog_ai_requests')
      .addColumn('id', 'bigint', (column) => column.unsigned().autoIncrement().primaryKey())
      .addColumn('job_id', 'char(36)', (column) => column.notNull().unique())
      .addColumn('requester_email', 'varchar(320)', (column) => column.notNull())
      .addColumn('workflow', sql`enum('create','update')`, (column) => column.notNull())
      .addColumn('request_kind', sql`enum('generate','review')`, (column) => column.notNull())
      .addColumn('catalog_key_snapshot', 'varchar(100)')
      .addColumn('base_revision', 'integer', (column) => column.unsigned())
      .addColumn('model', 'varchar(100)', (column) => column.notNull())
      .addColumn('prompt_version', 'varchar(40)', (column) => column.notNull())
      .addColumn('request_payload', 'json', (column) => column.notNull())
      .addColumn('attachments_json', 'json', (column) => column.notNull())
      .addColumn('response_payload', 'json')
      .addColumn('status', sql`enum('pending','completed','failed','cancelled')`, (column) => column.notNull())
      .addColumn('upstream_response_id', 'varchar(100)')
      .addColumn('error_code', 'varchar(80)')
      .addColumn('error_detail', 'varchar(500)')
      .addColumn('input_tokens', 'integer', (column) => column.unsigned())
      .addColumn('output_tokens', 'integer', (column) => column.unsigned())
      .addColumn('requested_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
      .addColumn('completed_at', 'datetime(3)')
      .addColumn('duration_ms', 'integer', (column) => column.unsigned())
      .execute()
    await database.schema.createIndex('idx_catalog_ai_requests_requested_at').on('catalog_ai_requests').column('requested_at').execute()
    await database.schema.createIndex('idx_catalog_ai_requests_email').on('catalog_ai_requests').column('requester_email').execute()
  },
  async down(database: Kysely<DatabaseSchema>): Promise<void> {
    await database.schema.dropTable('catalog_ai_requests').execute()
  },
}
