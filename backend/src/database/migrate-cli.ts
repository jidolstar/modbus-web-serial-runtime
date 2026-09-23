import { loadAppConfig } from '../config/app-config'
import { createDatabase } from './database.factory'
import { getMigrationStatus, migrateDown, migrateToLatest } from './migration-runner'

async function run(): Promise<void> {
  const command = process.argv[2]
  const database = createDatabase(loadAppConfig().database)
  try {
    if (command === 'up') {
      await migrateToLatest(database)
      console.info('Database migrations are up to date')
      return
    }
    if (command === 'down') {
      await migrateDown(database)
      console.info('The latest database migration was reverted')
      return
    }
    if (command === 'status') {
      const migrations = await getMigrationStatus(database)
      for (const migration of migrations) {
        console.info(`${migration.executedAt ? 'applied' : 'pending'} ${migration.name}`)
      }
      return
    }
    throw new Error('Expected migration command: up, down, or status')
  } finally {
    await database.destroy()
  }
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown migration error'
  console.error(`Database migration failed: ${message}`)
  process.exitCode = 1
})
