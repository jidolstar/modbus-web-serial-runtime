import { Body, Controller, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common'
import { ApiBody, ApiCookieAuth, ApiCreatedResponse, ApiExtraModels, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { SameOriginGuard } from '../auth/same-origin.guard'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'
import { CatalogDetailDto, CatalogErrorResponseDto, CatalogListResponseDto, CatalogStatusRequestDto, CatalogSummaryDto, CatalogUpdateRequestDto, CatalogValidationResponseDto, CatalogWriteRequestDto } from './catalog.dto'
import { parseCatalogListQuery, parseCatalogStatusInput, parseCatalogUpdateInput, parseCatalogWriteInput } from './catalog-input'
import { CatalogService } from './catalog.service'

const CATALOG_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/ // Profile ID와 같은 안전한 URL key. 예: "cwt-th04s"

function parseCatalogKey(value: string): string {
  if (value.length > 100 || !CATALOG_KEY_PATTERN.test(value)) {
    throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['catalogKey'])
  }
  return value
}

function requireUserId(request: FastifyRequest): number {
  if (!request.authUser) throw new CatalogError('AUTH_UNAUTHORIZED', 401)
  return request.authUser.id
}

/**
 * 인증된 관리자의 Catalog CRUD HTTP 계약을 제공한다.
 * SessionAuthGuard와 SameOriginGuard로 경계를 보호하고 실제 검증·DB 작업은 CatalogService에 위임한다.
 */
@ApiTags('Device Catalogs')
@ApiCookieAuth('sessionCookie')
@ApiExtraModels(CatalogWriteRequestDto, CatalogUpdateRequestDto, CatalogStatusRequestDto, CatalogSummaryDto, CatalogDetailDto, CatalogListResponseDto, CatalogValidationResponseDto, CatalogErrorResponseDto)
@UseGuards(SessionAuthGuard)
@Controller('catalogs')
export class CatalogController {
  public constructor(private readonly catalogService: CatalogService) {}

  /** 관리 화면의 저장 전 확인 버튼과 create/update가 같은 검증 결과를 사용하게 한다. */
  @Post('validate')
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: 'Catalog Bundle 사전 검증', description: 'DB를 변경하지 않고 title과 CatalogBundle v1의 Schema·참조·범위 규칙을 검사합니다. 허용된 Frontend origin에서만 호출할 수 있습니다.' })
  @ApiBody({ type: CatalogWriteRequestDto })
  @ApiOkResponse({ type: CatalogValidationResponseDto, description: '저장 가능한 Bundle이며 Profile ID에서 catalogKey를 추출했습니다.' })
  @ApiResponse({ status: 400, type: CatalogErrorResponseDto, description: '요청 필드, JSON Schema 또는 Profile–Recipe 의미 규칙이 잘못되었습니다.', example: { code: 'CATALOG_INVALID_INPUT', fields: ['/definition/profile/recipes'] } })
  @ApiResponse({ status: 401, type: CatalogErrorResponseDto, example: { code: 'AUTH_UNAUTHORIZED' } })
  @ApiResponse({ status: 403, type: CatalogErrorResponseDto, example: { code: 'AUTH_INVALID_ORIGIN' } })
  validate(@Body() body: unknown): { readonly valid: true; readonly catalogKey: string } {
    return this.catalogService.validate(parseCatalogWriteInput(body))
  }

  /** Catalog 관리 목록이 검색·상태 filter와 pagination을 적용할 때 호출한다. */
  @Get()
  @ApiOperation({ summary: '장비 Catalog 목록 조회', description: '전체 definition을 제외한 요약만 반환하며 title, key, 제조사와 모델을 통합 검색합니다.' })
  @ApiQuery({ name: 'q', required: false, example: 'TEMP-100', maxLength: 100 })
  @ApiQuery({ name: 'enabled', required: false, enum: ['true', 'false'], example: 'true' })
  @ApiQuery({ name: 'limit', required: false, example: 20, minimum: 1, maximum: 100 })
  @ApiQuery({ name: 'offset', required: false, example: 0, minimum: 0 })
  @ApiOkResponse({ type: CatalogListResponseDto, description: '검색 조건에 맞는 Catalog 요약 page입니다.' })
  @ApiResponse({ status: 400, type: CatalogErrorResponseDto, example: { code: 'CATALOG_INVALID_INPUT', fields: ['limit'] } })
  @ApiResponse({ status: 401, type: CatalogErrorResponseDto, example: { code: 'AUTH_UNAUTHORIZED' } })
  list(@Query() query: Record<string, unknown>) {
    return this.catalogService.list(parseCatalogListQuery(query))
  }

  /** JSON 관리 상세 화면이 현재 revision과 전체 Bundle을 불러올 때 호출한다. */
  @Get(':catalogKey')
  @ApiOperation({ summary: '장비 Catalog 상세 조회', description: '검증되어 저장된 전체 CatalogBundle과 현재 revision을 반환합니다.' })
  @ApiParam({ name: 'catalogKey', example: 'example-temperature-sensor' })
  @ApiOkResponse({ type: CatalogDetailDto })
  @ApiResponse({ status: 404, type: CatalogErrorResponseDto, example: { code: 'CATALOG_NOT_FOUND' } })
  @ApiResponse({ status: 401, type: CatalogErrorResponseDto, example: { code: 'AUTH_UNAUTHORIZED' } })
  get(@Param('catalogKey') catalogKey: string) {
    return this.catalogService.get(parseCatalogKey(catalogKey))
  }

  /** 관리 화면의 신규 등록에서 검증 완료된 Bundle을 revision 1로 저장한다. */
  @Post()
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: '장비 Catalog 등록', description: 'Profile ID를 catalogKey로 사용해 새 Catalog를 등록합니다. 동일 key는 중복 등록할 수 없습니다.' })
  @ApiBody({ type: CatalogWriteRequestDto })
  @ApiCreatedResponse({ type: CatalogDetailDto, description: 'revision 1로 생성된 Catalog 상세입니다.' })
  @ApiResponse({ status: 400, type: CatalogErrorResponseDto, example: { code: 'CATALOG_INVALID_INPUT', fields: ['/definition/recipes/0'] } })
  @ApiResponse({ status: 409, type: CatalogErrorResponseDto, example: { code: 'CATALOG_KEY_CONFLICT' } })
  @ApiResponse({ status: 413, type: CatalogErrorResponseDto, example: { code: 'CATALOG_INVALID_INPUT', fields: ['definition'] } })
  @ApiResponse({ status: 401, type: CatalogErrorResponseDto, example: { code: 'AUTH_UNAUTHORIZED' } })
  @ApiResponse({ status: 403, type: CatalogErrorResponseDto, example: { code: 'AUTH_INVALID_ORIGIN' } })
  create(@Body() body: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.create(parseCatalogWriteInput(body), requireUserId(request))
  }

  /** 상세 편집 화면이 title과 전체 Bundle을 낙관적 잠금으로 교체할 때 호출한다. */
  @Put(':catalogKey')
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: '장비 Catalog 전체 수정', description: 'URL key는 변경하지 않으며 현재 revision과 일치할 때만 title과 Bundle을 원자적으로 교체합니다.' })
  @ApiParam({ name: 'catalogKey', example: 'example-temperature-sensor' })
  @ApiBody({ type: CatalogUpdateRequestDto })
  @ApiOkResponse({ type: CatalogDetailDto, description: 'revision이 1 증가한 Catalog 상세입니다.' })
  @ApiResponse({ status: 400, type: CatalogErrorResponseDto, example: { code: 'CATALOG_INVALID_INPUT', fields: ['/definition/profile/id'] } })
  @ApiResponse({ status: 404, type: CatalogErrorResponseDto, example: { code: 'CATALOG_NOT_FOUND' } })
  @ApiResponse({ status: 409, type: CatalogErrorResponseDto, example: { code: 'CATALOG_REVISION_CONFLICT' } })
  @ApiResponse({ status: 401, type: CatalogErrorResponseDto, example: { code: 'AUTH_UNAUTHORIZED' } })
  @ApiResponse({ status: 403, type: CatalogErrorResponseDto, example: { code: 'AUTH_INVALID_ORIGIN' } })
  update(@Param('catalogKey') catalogKey: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.update(parseCatalogKey(catalogKey), parseCatalogUpdateInput(body), requireUserId(request))
  }

  /** 목록·상세 화면의 활성화 버튼이 definition을 바꾸지 않고 실행 가능 상태만 전환한다. */
  @Patch(':catalogKey/status')
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: '장비 Catalog 활성 상태 변경', description: 'soft state만 변경하며 비활성 Catalog도 관리 목록과 상세 조회에는 남습니다.' })
  @ApiParam({ name: 'catalogKey', example: 'example-temperature-sensor' })
  @ApiBody({ type: CatalogStatusRequestDto })
  @ApiOkResponse({ type: CatalogSummaryDto, description: 'revision이 1 증가한 Catalog 요약입니다.' })
  @ApiResponse({ status: 404, type: CatalogErrorResponseDto, example: { code: 'CATALOG_NOT_FOUND' } })
  @ApiResponse({ status: 409, type: CatalogErrorResponseDto, example: { code: 'CATALOG_REVISION_CONFLICT' } })
  @ApiResponse({ status: 401, type: CatalogErrorResponseDto, example: { code: 'AUTH_UNAUTHORIZED' } })
  @ApiResponse({ status: 403, type: CatalogErrorResponseDto, example: { code: 'AUTH_INVALID_ORIGIN' } })
  updateStatus(@Param('catalogKey') catalogKey: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.catalogService.updateStatus(parseCatalogKey(catalogKey), parseCatalogStatusInput(body), requireUserId(request))
  }
}
