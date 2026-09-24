import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiCookieAuth, ApiExtraModels, ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { CATALOG_BUNDLE_EXAMPLE, CatalogErrorResponseDto, RuntimeCatalogItemDto, RuntimeCatalogSnapshotDto } from './catalog.dto'
import { CatalogService } from './catalog.service'

/**
 * Browser 실행 엔진에 활성 CatalogBundle의 한 시점 snapshot을 제공한다.
 * SessionAuthGuard로 인증을 확인하고 실제 DB 조회와 저장 JSON 재검증은 CatalogService에 위임한다.
 */
@ApiTags('Runtime Catalog')
@ApiCookieAuth('sessionCookie')
@ApiExtraModels(RuntimeCatalogItemDto, RuntimeCatalogSnapshotDto, CatalogErrorResponseDto)
@UseGuards(SessionAuthGuard)
@Controller('runtime/catalog')
export class CatalogRuntimeController {
  public constructor(private readonly catalogService: CatalogService) {}

  /** DynamicDeviceRuntime 초기화에서 호출해 비활성 정의를 제외한 전체 실행 snapshot을 받는다. */
  @Get()
  @ApiOperation({
    summary: '활성 Runtime Catalog snapshot 조회',
    description: '현재 활성화된 CatalogBundle 전체를 반환합니다. Browser는 응답 전체를 검증한 후 원자적으로 적용하며 실행 중인 작업에는 이후 변경을 섞지 않습니다.',
  })
  @ApiOkResponse({
    type: RuntimeCatalogSnapshotDto,
    description: 'catalogKey 오름차순의 활성 Catalog snapshot입니다.',
    example: { items: [{ catalogKey: 'example-temperature-sensor', revision: 3, definition: CATALOG_BUNDLE_EXAMPLE }] },
  })
  @ApiResponse({ status: 401, type: CatalogErrorResponseDto, description: '유효한 HttpOnly session cookie가 없습니다.', example: { code: 'AUTH_UNAUTHORIZED' } })
  getSnapshot() {
    return this.catalogService.getRuntimeSnapshot()
  }
}
