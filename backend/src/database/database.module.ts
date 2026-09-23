import { Global, Inject, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Kysely } from 'kysely'
import { APP_CONFIG } from '../config/config.module'
import { AppConfig } from '../config/app-config'
import { createDatabase } from './database.factory'
import { DatabaseSchema } from './database.types'
import { migrateToLatest } from './migration-runner'

export const DATABASE = Symbol('DATABASE')

@Injectable()
class DatabaseLifecycle implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(DATABASE) private readonly database: Kysely<DatabaseSchema>) {}

  async onModuleInit(): Promise<void> {
    await migrateToLatest(this.database)
  }

  async onModuleDestroy(): Promise<void> {
    await this.database.destroy()
  }
}

@Global()
@Module({
  providers: [
    {
      provide: DATABASE,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): Kysely<DatabaseSchema> => createDatabase(config.database),
    },
    DatabaseLifecycle,
  ],
  exports: [DATABASE],
})
export class DatabaseModule {}
