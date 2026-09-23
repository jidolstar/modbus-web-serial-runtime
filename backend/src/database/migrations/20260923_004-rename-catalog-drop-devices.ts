import { Generated, Kysely, sql } from 'kysely'
import { Migration } from 'kysely/migration'
import type { CatalogsTable, DatabaseSchema } from '../database.types'

interface LegacyDevicesTable {
  id: Generated<number>
  created_by_user_id: number
  name: string
  profile_id: string
  slave_id: number
  baud_rate: number
  data_bits: number
  stop_bits: number
  parity: 'none' | 'even' | 'odd'
  enabled: Generated<boolean>
  notes: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

interface CatalogRenameMigrationSchema extends DatabaseSchema {
  devices: LegacyDevicesTable // 제거 전 초기 migration이 만든 미사용 설치 장비 table
  device_catalogs: CatalogsTable // rename 전 Catalog table 이름
}

async function tableExists(database: Kysely<CatalogRenameMigrationSchema>, tableName: string): Promise<boolean> {
  const tables = await database.introspection.getTables()
  return tables.some((table) => table.name === tableName)
}

/**
 * phpMyAdmin에서 Catalog 관련 table이 함께 정렬되도록 기준 table을 `catalog`로 바꾼다.
 * 애플리케이션이 사용하지 않는 과거 `devices` row는 사용자 결정에 따라 table과 함께 제거한다.
 */
export const renameCatalogDropDevicesMigration: Migration = {
  async up(database: Kysely<CatalogRenameMigrationSchema>): Promise<void> {
    // MySQL DDL은 자동 commit되므로 재시도 시 이미 끝난 단계를 안전하게 건너뛴다.
    if (await tableExists(database, 'devices')) await database.schema.dropTable('devices').execute()
    if (await tableExists(database, 'device_catalogs')) {
      await database.schema.alterTable('device_catalogs').renameTo('catalog').execute()
    }
    if (!await tableExists(database, 'catalog')) throw new Error('Catalog table rename did not produce catalog')
  },

  async down(database: Kysely<CatalogRenameMigrationSchema>): Promise<void> {
    if (await tableExists(database, 'catalog')) {
      await database.schema.alterTable('catalog').renameTo('device_catalogs').execute()
    }
    if (!await tableExists(database, 'devices')) {
      await database.schema.createTable('devices')
        .addColumn('id', 'bigint', (column) => column.unsigned().autoIncrement().primaryKey())
        .addColumn('created_by_user_id', 'bigint', (column) => column.unsigned().notNull())
        .addColumn('name', 'varchar(100)', (column) => column.notNull())
        .addColumn('profile_id', 'varchar(100)', (column) => column.notNull())
        .addColumn('slave_id', 'smallint', (column) => column.unsigned().notNull())
        .addColumn('baud_rate', 'integer', (column) => column.unsigned().notNull())
        .addColumn('data_bits', 'smallint', (column) => column.unsigned().notNull())
        .addColumn('stop_bits', 'smallint', (column) => column.unsigned().notNull())
        .addColumn('parity', sql`enum('none', 'even', 'odd')`, (column) => column.notNull())
        .addColumn('enabled', 'boolean', (column) => column.notNull().defaultTo(true))
        .addColumn('notes', 'varchar(1000)')
        .addColumn('created_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
        .addColumn('updated_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`))
        .addForeignKeyConstraint('fk_devices_created_by_user', ['created_by_user_id'], 'users', ['id'], (constraint) => constraint.onDelete('restrict'))
        .addCheckConstraint('chk_devices_slave_id', sql`slave_id BETWEEN 1 AND 247`)
        .addCheckConstraint('chk_devices_baud_rate', sql`baud_rate BETWEEN 300 AND 4000000`)
        .addCheckConstraint('chk_devices_data_bits', sql`data_bits IN (7, 8)`)
        .addCheckConstraint('chk_devices_stop_bits', sql`stop_bits IN (1, 2)`)
        .execute()
      await database.schema.createIndex('idx_devices_created_by_user_id').on('devices').column('created_by_user_id').execute()
    }
  },
}
