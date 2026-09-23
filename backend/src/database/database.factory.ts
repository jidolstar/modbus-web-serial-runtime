import { Kysely, MysqlDialect } from 'kysely'
import { createPool } from 'mysql2'
import { AppConfig } from '../config/app-config'
import { DatabaseSchema } from './database.types'

export function createDatabase(config: AppConfig['database']): Kysely<DatabaseSchema> {
  return new Kysely<DatabaseSchema>({
    dialect: new MysqlDialect({
      pool: createPool({
        host: config.host,
        port: config.port,
        database: config.name,
        user: config.user,
        password: config.password,
        ssl: config.ssl ? {} : undefined,
        connectionLimit: 10,
      }),
    }),
  })
}
