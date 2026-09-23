import { Kysely, sql } from 'kysely'
import {
  Migration,
  MigrationInfo,
  MigrationProvider,
  MigrationResult,
  Migrator,
} from 'kysely/migration'
import { DatabaseSchema } from './database.types'
import { initialSchemaMigration } from './migrations/20260922_001_initial-schema'

const MIGRATION_LOCK_NAME = 'modbus_manager_migrations'
const MIGRATION_LOCK_TIMEOUT_SECONDS = 30

class StaticMigrationProvider implements MigrationProvider {
  async getMigrations(): Promise<Record<string, Migration>> {
    return {
      '20260922_001_initial-schema': initialSchemaMigration,
    }
  }
}

function createMigrator(database: Kysely<DatabaseSchema>): Migrator {
  return new Migrator({ db: database, provider: new StaticMigrationProvider() })
}

async function withMigrationLock<T>(
  database: Kysely<DatabaseSchema>,
  operation: () => Promise<T>,
): Promise<T> {
  const lockResult = await sql<{ acquired: number | null }>`
    SELECT GET_LOCK(${MIGRATION_LOCK_NAME}, ${MIGRATION_LOCK_TIMEOUT_SECONDS}) AS acquired
  `.execute(database)
  if (lockResult.rows[0]?.acquired !== 1) {
    throw new Error('Could not acquire the database migration lock')
  }

  try {
    return await operation()
  } finally {
    await sql`SELECT RELEASE_LOCK(${MIGRATION_LOCK_NAME})`.execute(database)
  }
}

function assertMigrationSuccess(error: unknown, results?: readonly MigrationResult[]): void {
  if (error) throw error
  const failed = results?.find((result) => result.status === 'Error')
  if (failed) throw new Error(`Migration ${failed.migrationName} failed`)
}

export async function migrateToLatest(database: Kysely<DatabaseSchema>): Promise<void> {
  await withMigrationLock(database, async () => {
    const { error, results } = await createMigrator(database).migrateToLatest()
    assertMigrationSuccess(error, results)
  })
}

export async function migrateDown(database: Kysely<DatabaseSchema>): Promise<void> {
  await withMigrationLock(database, async () => {
    const { error, results } = await createMigrator(database).migrateDown()
    assertMigrationSuccess(error, results)
  })
}

export async function getMigrationStatus(
  database: Kysely<DatabaseSchema>,
): Promise<readonly MigrationInfo[]> {
  return createMigrator(database).getMigrations()
}
