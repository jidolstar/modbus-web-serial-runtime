import { Module } from '@nestjs/common'
import { AuthModule } from '../auth/auth.module'
import { CatalogController } from './catalog.controller'
import { CatalogRepository } from './catalog.repository'
import { CatalogService } from './catalog.service'
import { CatalogValidationService } from './catalog-validation.service'
import { CatalogAssetController } from './catalog-asset.controller'
import { CatalogAssetRepository } from './catalog-asset.repository'
import { CatalogAssetService } from './catalog-asset.service'
import { CatalogStorageService } from './catalog-storage.service'

/** Catalog API의 controller, validation, use case와 repository 의존성을 조립한다. */
@Module({
  imports: [AuthModule],
  controllers: [CatalogController, CatalogAssetController],
  providers: [CatalogValidationService, CatalogRepository, CatalogService, CatalogAssetRepository, CatalogAssetService, CatalogStorageService],
})
export class CatalogModule {}
