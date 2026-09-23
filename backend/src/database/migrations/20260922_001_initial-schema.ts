import { Kysely, sql } from 'kysely'
import { Migration } from 'kysely/migration'
import { DatabaseSchema } from '../database.types'

export const initialSchemaMigration: Migration = {
  async up(database: Kysely<DatabaseSchema>): Promise<void> {
    await database.schema
      .createTable('users')
      .addColumn('id', 'bigint', (column) => column.unsigned().autoIncrement().primaryKey())
      .addColumn('google_subject', 'varchar(255)', (column) => column.notNull().unique())
      .addColumn('email', 'varchar(320)', (column) => column.notNull().unique())
      .addColumn('display_name', 'varchar(255)')
      .addColumn('avatar_url', 'varchar(2048)')
      .addColumn('last_login_at', 'datetime(3)', (column) => column.notNull())
      .addColumn('disabled_at', 'datetime(3)')
      .addColumn('created_at', 'datetime(3)', (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
      )
      .addColumn('updated_at', 'datetime(3)', (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`),
      )
      .execute()

    await database.schema
      .createTable('auth_sessions')
      .addColumn('id', 'bigint', (column) => column.unsigned().autoIncrement().primaryKey())
      .addColumn('user_id', 'bigint', (column) => column.unsigned().notNull())
      .addColumn('token_jti_hash', 'char(64)', (column) => column.notNull().unique())
      .addColumn('expires_at', 'datetime(3)', (column) => column.notNull())
      .addColumn('revoked_at', 'datetime(3)')
      .addColumn('created_at', 'datetime(3)', (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
      )
      .addColumn('last_seen_at', 'datetime(3)')
      .addForeignKeyConstraint('fk_auth_sessions_user', ['user_id'], 'users', ['id'], (constraint) =>
        constraint.onDelete('cascade'),
      )
      .execute()

    await database.schema
      .createIndex('idx_auth_sessions_user_id')
      .on('auth_sessions')
      .column('user_id')
      .execute()
    await database.schema
      .createIndex('idx_auth_sessions_expires_at')
      .on('auth_sessions')
      .column('expires_at')
      .execute()

    await database.schema
      .createTable('devices')
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
      .addColumn('created_at', 'datetime(3)', (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`),
      )
      .addColumn('updated_at', 'datetime(3)', (column) =>
        column.notNull().defaultTo(sql`CURRENT_TIMESTAMP(3)`).modifyEnd(sql`ON UPDATE CURRENT_TIMESTAMP(3)`),
      )
      .addForeignKeyConstraint(
        'fk_devices_created_by_user',
        ['created_by_user_id'],
        'users',
        ['id'],
        (constraint) => constraint.onDelete('restrict'),
      )
      .addCheckConstraint('chk_devices_slave_id', sql`slave_id BETWEEN 1 AND 247`)
      .addCheckConstraint('chk_devices_baud_rate', sql`baud_rate BETWEEN 300 AND 4000000`)
      .addCheckConstraint('chk_devices_data_bits', sql`data_bits IN (7, 8)`)
      .addCheckConstraint('chk_devices_stop_bits', sql`stop_bits IN (1, 2)`)
      .execute()

    await database.schema
      .createIndex('idx_devices_created_by_user_id')
      .on('devices')
      .column('created_by_user_id')
      .execute()
  },

  async down(database: Kysely<DatabaseSchema>): Promise<void> {
    await database.schema.dropTable('devices').execute()
    await database.schema.dropTable('auth_sessions').execute()
    await database.schema.dropTable('users').execute()
  },
}
