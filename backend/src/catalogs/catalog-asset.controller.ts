import { applyDecorators, Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, Res, StreamableFile, UseGuards } from '@nestjs/common'
import { ApiBody, ApiConsumes, ApiCookieAuth, ApiCreatedResponse, ApiExtraModels, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { SameOriginGuard } from '../auth/same-origin.guard'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { parseCatalogAssetId, parseCatalogLinkInput } from './catalog-asset-input'
import { CatalogFileDto, CatalogLinkDto, CatalogLinkWriteDto, CatalogThumbnailResponseDto } from './catalog-asset.dto'
import { CatalogAssetService } from './catalog-asset.service'
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'

const CATALOG_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

function parseCatalogKey(value: string): string {
  if (value.length > 100 || !CATALOG_KEY_PATTERN.test(value)) throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['catalogKey'])
  return value
}

function requireUserId(request: FastifyRequest): number {
  if (!request.authUser) throw new CatalogError('AUTH_UNAUTHORIZED', 401)
  return request.authUser.id
}

async function requireUpload(request: FastifyRequest) {
  const upload = await request.file()
  if (!upload) throw new CatalogError(CATALOG_ERROR_CODES.assetInvalidInput, 400, ['file'])
  return upload
}

function attachmentFileName(value: string): string {
  const fallback = value.replace(/[^0-9A-Za-z._-]/g, '_') || 'download'
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(value)}`
}

/** 상태 변경 endpoint의 strict Origin 실패 계약을 Swagger에 빠짐없이 반복 적용한다. */
function ApiCatalogAssetWriteSecurity() {
  return applyDecorators(ApiResponse({ status: 403, description: '허용된 Frontend origin이 아닙니다.', example: { code: 'AUTH_INVALID_ORIGIN' } }))
}

/**
 * 인증된 Catalog 관리 화면에 썸네일, 참고 파일과 HTTPS 링크 API를 제공한다.
 * SameOriginGuard가 모든 변경 요청을 보호하고 저장·검증·DB 일관성은 CatalogAssetService에 위임한다.
 */
@ApiTags('Device Catalog Assets')
@ApiCookieAuth('sessionCookie')
@ApiExtraModels(CatalogThumbnailResponseDto, CatalogFileDto, CatalogLinkDto, CatalogLinkWriteDto)
@ApiResponse({ status: 401, description: '유효한 HttpOnly session cookie가 없습니다.', example: { code: 'AUTH_UNAUTHORIZED' } })
@ApiResponse({ status: 404, description: 'Catalog 또는 지정 asset을 찾을 수 없습니다.', example: { code: 'CATALOG_ASSET_NOT_FOUND' } })
@UseGuards(SessionAuthGuard)
@Controller('catalogs/:catalogKey')
export class CatalogAssetController {
  public constructor(private readonly assets: CatalogAssetService) {}

  /** 상세 화면에서 새 원본을 등록하거나 기존 썸네일을 교체할 때 호출한다. 삭제 route는 제공하지 않는다. */
  @Put('thumbnail')
  @UseGuards(SameOriginGuard)
  @ApiCatalogAssetWriteSecurity()
  @ApiOperation({ summary: 'Catalog 썸네일 등록 또는 교체', description: 'PNG/JPEG/WebP 원본을 방향 보정하고 중앙 1:1 crop한 300×300 JPEG로 재인코딩합니다. 기존 썸네일은 새 변환과 DB 갱신이 성공한 뒤 교체됩니다.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary', description: '최대 CATALOG_THUMBNAIL_MAX_BYTES인 PNG/JPEG/WebP 이미지' } } } })
  @ApiOkResponse({ type: CatalogThumbnailResponseDto, example: { etag: '4d7d9c4f18d1473f20f768a5ad458e3055dc951e6d8539d3117b03bf32834c8b', byteSize: 18420, contentType: 'image/jpeg' } })
  @ApiResponse({ status: 400, example: { code: 'CATALOG_ASSET_INVALID_INPUT', fields: ['file'] } })
  @ApiResponse({ status: 413, example: { code: 'CATALOG_FILE_TOO_LARGE', fields: ['file'] } })
  @ApiResponse({ status: 415, example: { code: 'CATALOG_FILE_TYPE_REJECTED', fields: ['file'] } })
  async replaceThumbnail(@Param('catalogKey') key: string, @Req() request: FastifyRequest) {
    return this.assets.replaceThumbnail(parseCatalogKey(key), await requireUpload(request), requireUserId(request))
  }

  /** 목록·상세 카드가 변환 완료된 JPEG를 ETag cache와 함께 표시할 때 호출한다. */
  @Get('thumbnail')
  @ApiOperation({ summary: 'Catalog 썸네일 조회', description: '인증된 사용자에게 300×300 JPEG를 반환합니다. If-None-Match와 일치하면 304를 반환합니다.' })
  @ApiProduces('image/jpeg')
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' }, headers: { ETag: { description: 'SHA-256 기반 cache validator', schema: { type: 'string', example: '"4d7d9c4f18d1473f20f768a5ad458e3055dc951e6d8539d3117b03bf32834c8b"' } } } })
  @ApiResponse({ status: 304, description: '브라우저가 가진 썸네일이 최신입니다.' })
  @ApiResponse({ status: 404, example: { code: 'CATALOG_ASSET_NOT_FOUND' } })
  async getThumbnail(@Param('catalogKey') key: string, @Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.assets.getThumbnail(parseCatalogKey(key))
    const etag = `"${result.etag}"`
    if (request.headers['if-none-match'] === etag) return reply.status(304).send()
    reply.header('Content-Type', 'image/jpeg').header('Content-Length', result.byteSize).header('ETag', etag).header('Cache-Control', 'private, max-age=3600')
    return new StreamableFile(result.stream)
  }

  /** 자료 관리 영역에서 문서 유형·제목과 파일 stream을 함께 등록할 때 호출한다. */
  @Post('files')
  @UseGuards(SameOriginGuard)
  @ApiCatalogAssetWriteSecurity()
  @ApiOperation({ summary: 'Catalog 참고 파일 등록', description: 'PDF, UTF-8 TXT, PNG, JPEG, WebP, DOC, DOCX만 허용하며 확장자·MIME·magic/container 검사를 통과한 파일만 clean으로 등록합니다.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['title', 'documentType', 'file'], properties: { title: { type: 'string', example: 'RS485 통신 프로토콜', maxLength: 160 }, documentType: { type: 'string', enum: ['communication_protocol', 'manual', 'datasheet', 'reference_image', 'other'], example: 'communication_protocol' }, file: { type: 'string', format: 'binary' } } } })
  @ApiCreatedResponse({ type: CatalogFileDto, example: { id: 12, title: 'RS485 통신 프로토콜', documentType: 'communication_protocol', originalName: 'protocol.pdf', contentType: 'application/pdf', byteSize: 240123, sha256: '08e5a4ddab908d66bc10c402485af267e450d2c0f5f672b7757262f92642fd3b', status: 'clean', createdAt: '2026-09-23T00:00:00.000Z' } })
  @ApiResponse({ status: 400, example: { code: 'CATALOG_ASSET_INVALID_INPUT', fields: ['documentType'] } })
  @ApiResponse({ status: 413, example: { code: 'CATALOG_FILE_TOO_LARGE', fields: ['file'] } })
  @ApiResponse({ status: 415, example: { code: 'CATALOG_FILE_TYPE_REJECTED', fields: ['file'] } })
  async uploadFile(@Param('catalogKey') key: string, @Req() request: FastifyRequest) {
    return this.assets.uploadFile(parseCatalogKey(key), await requireUpload(request), requireUserId(request))
  }

  @Get('files')
  @ApiOperation({ summary: 'Catalog 참고 파일 목록', description: 'storage 내부 경로를 제외한 파일 metadata와 검증 상태를 반환합니다.' })
  @ApiOkResponse({ type: [CatalogFileDto] })
  listFiles(@Param('catalogKey') key: string) { return this.assets.listFiles(parseCatalogKey(key)) }

  @Get('files/:fileId/download')
  @ApiOperation({ summary: '검증 완료 참고 파일 다운로드', description: 'clean 상태 파일만 attachment로 반환하며 inline 문서 실행을 허용하지 않습니다.' })
  @ApiProduces('application/octet-stream')
  @ApiParam({ name: 'fileId', example: 12 })
  @ApiOkResponse({ schema: { type: 'string', format: 'binary' } })
  @ApiResponse({ status: 409, example: { code: 'CATALOG_FILE_NOT_CLEAN' } })
  async downloadFile(@Param('catalogKey') key: string, @Param('fileId') fileId: string, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.assets.downloadFile(parseCatalogKey(key), parseCatalogAssetId(fileId))
    reply.header('Content-Type', result.file.contentType).header('Content-Length', result.file.byteSize).header('Content-Disposition', attachmentFileName(result.file.originalName)).header('X-Content-Type-Options', 'nosniff').header('Cache-Control', 'private, no-store')
    return new StreamableFile(result.stream)
  }

  @Delete('files/:fileId')
  @UseGuards(SameOriginGuard)
  @ApiCatalogAssetWriteSecurity()
  @HttpCode(204)
  @ApiOperation({ summary: 'Catalog 참고 파일 삭제', description: 'volume 파일을 임시 trash로 이동한 뒤 metadata를 삭제해 실패 시 복원할 수 있게 합니다.' })
  @ApiNoContentResponse({ description: '파일과 metadata를 삭제했습니다.' })
  async deleteFile(@Param('catalogKey') key: string, @Param('fileId') fileId: string): Promise<void> {
    await this.assets.deleteFile(parseCatalogKey(key), parseCatalogAssetId(fileId))
  }

  @Get('links')
  @ApiOperation({ summary: 'Catalog 참고 링크 목록', description: '서버가 URL을 방문하지 않고 저장된 HTTPS 링크 metadata만 반환합니다.' })
  @ApiOkResponse({ type: [CatalogLinkDto] })
  listLinks(@Param('catalogKey') key: string) { return this.assets.listLinks(parseCatalogKey(key)) }

  @Post('links')
  @UseGuards(SameOriginGuard)
  @ApiCatalogAssetWriteSecurity()
  @ApiOperation({ summary: 'Catalog 참고 링크 등록', description: 'credential, HTTP, localhost와 IP literal을 제외한 public HTTPS URL을 제목·유형과 함께 저장합니다.' })
  @ApiBody({ type: CatalogLinkWriteDto })
  @ApiCreatedResponse({ type: CatalogLinkDto, example: { id: 5, title: '제조사 제품 페이지', linkType: 'official_website', url: 'https://example.com/products/temp-100', createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z' } })
  createLink(@Param('catalogKey') key: string, @Body() body: unknown, @Req() request: FastifyRequest) { return this.assets.createLink(parseCatalogKey(key), parseCatalogLinkInput(body), requireUserId(request)) }

  @Put('links/:linkId')
  @UseGuards(SameOriginGuard)
  @ApiCatalogAssetWriteSecurity()
  @ApiOperation({ summary: 'Catalog 참고 링크 수정', description: '소속 Catalog의 링크 제목·유형·HTTPS URL 전체를 교체합니다.' })
  @ApiBody({ type: CatalogLinkWriteDto })
  @ApiOkResponse({ type: CatalogLinkDto })
  updateLink(@Param('catalogKey') key: string, @Param('linkId') linkId: string, @Body() body: unknown, @Req() request: FastifyRequest) { return this.assets.updateLink(parseCatalogKey(key), parseCatalogAssetId(linkId), parseCatalogLinkInput(body), requireUserId(request)) }

  @Delete('links/:linkId')
  @UseGuards(SameOriginGuard)
  @ApiCatalogAssetWriteSecurity()
  @HttpCode(204)
  @ApiOperation({ summary: 'Catalog 참고 링크 삭제', description: '소속 Catalog에서 지정 링크 metadata를 삭제합니다.' })
  @ApiNoContentResponse({ description: '링크를 삭제했습니다.' })
  async deleteLink(@Param('catalogKey') key: string, @Param('linkId') linkId: string): Promise<void> { await this.assets.deleteLink(parseCatalogKey(key), parseCatalogAssetId(linkId)) }
}
