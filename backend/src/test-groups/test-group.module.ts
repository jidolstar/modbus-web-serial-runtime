import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CatalogModule } from '../catalogs/catalog.module'
import { TestGroupController } from './test-group.controller'
import { TestGroupRepository } from './test-group.repository'
import { TestGroupService } from './test-group.service'

/** Test Group API, 사용자별 영속화와 Catalog snapshot 검증 의존성을 조립한다. */
@Module({ imports: [AuthModule, CatalogModule], controllers: [TestGroupController], providers: [TestGroupRepository, TestGroupService] })
export class TestGroupModule {}
