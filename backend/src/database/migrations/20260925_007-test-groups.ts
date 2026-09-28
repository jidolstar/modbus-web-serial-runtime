import { Kysely, sql } from 'kysely'
import { Migration } from 'kysely/migration'
import { DatabaseSchema } from '../database.types'

/** 사용자별 RS485 버스 구성과 순서가 있는 Catalog node를 저장한다. Serial port와 측정값은 브라우저에만 남긴다. */
export const testGroupsMigration: Migration = {
  async up(database: Kysely<DatabaseSchema>): Promise<void> {
    await database.schema.createTable('test_groups')
      .addColumn('id', 'bigint', (column) => column.unsigned().autoIncrement().primaryKey())
      .addColumn('owner_user_id', 'bigint', (column) => column.unsigned().notNull())
      .addColumn('name', 'varchar(100)', (column) => column.notNull())
      .addColumn('revision', 'integer', (column) => column.unsigned().notNull().defaultTo(1))
      .addColumn('baud_rate', 'integer', (column) => column.unsigned().notNull())
      .addColumn('data_bits', 'smallint', (column) => column.unsigned().notNull())
      .addColumn('stop_bits', 'smallint', (column) => column.unsigned().notNull())
      .addColumn('parity', sql`enum('none','even','odd')`, (column) => column.notNull())
      .addColumn('flow_control', sql`enum('none','hardware')`, (column) => column.notNull())
      .addColumn('created_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
      .addColumn('updated_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`))
      .addForeignKeyConstraint('fk_test_groups_owner', ['owner_user_id'], 'users', ['id'], (constraint) => constraint.onDelete('cascade'))
      .execute()
    await database.schema.createIndex('idx_test_groups_owner_updated').on('test_groups').columns(['owner_user_id', 'updated_at']).execute()

    await database.schema.createTable('test_group_nodes')
      .addColumn('id', 'bigint', (column) => column.unsigned().autoIncrement().primaryKey())
      .addColumn('test_group_id', 'bigint', (column) => column.unsigned().notNull())
      .addColumn('name', 'varchar(100)', (column) => column.notNull())
      .addColumn('catalog_id', 'bigint', (column) => column.unsigned().notNull())
      .addColumn('catalog_revision', 'integer', (column) => column.unsigned().notNull())
      .addColumn('slave_id', 'smallint', (column) => column.unsigned().notNull())
      .addColumn('position', 'smallint', (column) => column.unsigned().notNull())
      .addColumn('created_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`))
      .addColumn('updated_at', 'datetime(3)', (column) => column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`))
      .addUniqueConstraint('uq_test_group_nodes_slave', ['test_group_id', 'slave_id'])
      .addUniqueConstraint('uq_test_group_nodes_position', ['test_group_id', 'position'])
      .addForeignKeyConstraint('fk_test_group_nodes_group', ['test_group_id'], 'test_groups', ['id'], (constraint) => constraint.onDelete('cascade'))
      .addForeignKeyConstraint('fk_test_group_nodes_catalog', ['catalog_id'], 'catalog', ['id'], (constraint) => constraint.onDelete('restrict'))
      .execute()
  },
  async down(database: Kysely<DatabaseSchema>): Promise<void> {
    await database.schema.dropTable('test_group_nodes').execute()
    await database.schema.dropTable('test_groups').execute()
  },
}
