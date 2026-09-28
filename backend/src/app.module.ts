import { Module } from '@nestjs/common'
import { AuthModule } from './auth/auth.module'
import { CatalogModule } from './catalogs/catalog.module'
import { ConfigModule } from './config/config.module'
import { DatabaseModule } from './database/database.module'
import { HealthController } from './health.controller'
import { TestGroupModule } from './test-groups/test-group.module'

@Module({
  imports: [ConfigModule, DatabaseModule, AuthModule, CatalogModule, TestGroupModule],
  controllers: [HealthController],
})
export class AppModule {}
