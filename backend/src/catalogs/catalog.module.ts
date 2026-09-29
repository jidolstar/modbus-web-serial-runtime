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
import { CatalogRuntimeController } from './catalog-runtime.controller'
import { CatalogAiController } from './catalog-ai.controller'
import { CatalogAiService } from './catalog-ai.service'
import { CatalogAiApprovalService } from './catalog-ai-approval.service'
import { CatalogAiRequestRepository } from './catalog-ai-request.repository'
import { CatalogAiSessionService } from './catalog-ai-session.service'
import { GeminiCatalogClient } from './gemini-catalog.client'
import { GeminiFileService } from './gemini-file.service'

/** Catalog API의 controller, validation, use case와 repository 의존성을 조립한다. */
@Module({
  imports: [AuthModule],
  controllers: [CatalogController, CatalogAssetController, CatalogRuntimeController, CatalogAiController],
  providers: [
    CatalogValidationService, CatalogRepository, CatalogService, CatalogAssetRepository, CatalogAssetService, CatalogStorageService,
    CatalogAiService, CatalogAiApprovalService, CatalogAiRequestRepository, CatalogAiSessionService, GeminiFileService, GeminiCatalogClient,
  ],
  exports: [CatalogRepository, CatalogValidationService],
})
export class CatalogModule {}
