import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ApiAcceptedResponse, ApiBody, ApiConsumes, ApiCookieAuth, ApiCreatedResponse, ApiExtraModels, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { Readable } from 'node:stream'
import { SameOriginGuard } from '../auth/same-origin.guard'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { CatalogAiApprovalService } from './catalog-ai-approval.service'
import { CatalogAiApprovalRequestDto, CatalogAiApprovalResponseDto, CatalogAiEditApprovalRequestDto, CatalogAiEditApprovalResponseDto, CatalogAiJobAcceptedDto, CatalogAiJobDto } from './catalog-ai.dto'
import { AI_MAX_FILES, parseCatalogAiApproval, parseCatalogAiEditApproval, parseCatalogAiTextInput } from './catalog-ai-input'
import { CatalogAiService, type CatalogAiUpload } from './catalog-ai.service'
import { CatalogAiSessionService } from './catalog-ai-session.service'
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'
import { CatalogErrorResponseDto } from './catalog.dto'

function user(request: FastifyRequest): { readonly id: number; readonly email: string } {
  if (!request.authUser) throw new CatalogError('AUTH_UNAUTHORIZED', 401)
  return { id: request.authUser.id, email: request.authUser.email }
}

/** URL 식별자가 예상한 UUID 모양인지 경계에서 확인해 내부 job/session lookup에 임의 문자열을 넘기지 않는다. */
function uuid(value: string): string {
  if (!/^[0-9a-f-]{36}$/.test(value)) throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, ['id'])
  return value
}

/** AI 수정 URL의 제품 키를 일반 Catalog API와 같은 제한으로 검사한다. */
function parseCatalogKey(value: string): string {
  if (!/^[a-z0-9][a-z0-9._-]{0,99}$/.test(value)) throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, ['catalogKey'])
  return value
}

/** AI Catalog 생성 job, 상태 조회, 취소와 승인 HTTP 계약을 제공한다. */
@ApiTags('AI Device Catalogs')
@ApiCookieAuth('sessionCookie')
@ApiExtraModels(CatalogAiJobAcceptedDto, CatalogAiJobDto, CatalogAiApprovalRequestDto, CatalogAiApprovalResponseDto, CatalogAiEditApprovalRequestDto, CatalogAiEditApprovalResponseDto, CatalogErrorResponseDto)
@UseGuards(SessionAuthGuard)
@Controller('catalogs/ai')
export class CatalogAiController {
  public constructor(
    private readonly ai: CatalogAiService,
    private readonly approval: CatalogAiApprovalService,
    private readonly sessions: CatalogAiSessionService,
  ) {}

  /** 신규 작성과 AI 수정 multipart가 같은 제한으로 upload를 읽도록 공통 변환한다. */
  private async multipart(request: FastifyRequest): Promise<{ fields: Record<string, string>; uploads: CatalogAiUpload[] }> {
    const fields: Record<string, string> = {}
    const uploads: CatalogAiUpload[] = []
    for await (const part of request.parts({ limits: { files: AI_MAX_FILES, fields: 5, parts: AI_MAX_FILES + 5 } })) {
      if (part.type === 'file') uploads.push({ stream: Readable.from(await part.toBuffer()), filename: part.filename, mimetype: part.mimetype })
      else if (typeof part.value === 'string') fields[part.fieldname] = part.value
    }
    return { fields, uploads }
  }

  @Post('jobs')
  @UseGuards(SameOriginGuard)
  @HttpCode(202)
  @ApiOperation({ summary: 'AI Catalog 생성 작업 시작', description: '요구사항과 최대 5개 참고 파일을 임시 세션에 저장하고 비동기 Gemini 작업을 시작합니다. 허용된 origin과 인증 cookie가 필요합니다.' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ description: '추가 설명, 참고 URL, 문서·이미지 중 하나 이상을 제공합니다. 재검토는 기존 세션 첨부도 입력 근거로 인정합니다.', schema: { type: 'object', properties: { requirements: { type: 'string', maxLength: 10000, description: '자료에 없는 내용을 보완하는 선택 설명', example: '온도 측정값과 안전하게 확인된 설정 기능만 포함해 주세요.' }, referenceUrls: { type: 'string', description: 'public HTTPS URL의 JSON 배열', example: '["https://example.com/manual"]' }, revisionInstruction: { type: 'string', maxLength: 5000 }, previousProposal: { type: 'string' }, sessionId: { type: 'string', format: 'uuid' }, files: { type: 'array', maxItems: 5, items: { type: 'string', format: 'binary' } } } } })
  @ApiAcceptedResponse({ type: CatalogAiJobAcceptedDto })
  @ApiResponse({ status: 400, type: CatalogErrorResponseDto, example: { code: 'CATALOG_AI_INVALID_INPUT', fields: ['requirements', 'referenceUrls', 'files'] } })
  @ApiResponse({ status: 413, type: CatalogErrorResponseDto, example: { code: 'CATALOG_FILE_TOO_LARGE', fields: ['files'] } })
  @ApiResponse({ status: 415, type: CatalogErrorResponseDto, example: { code: 'CATALOG_FILE_TYPE_REJECTED', fields: ['file'] } })
  @ApiResponse({ status: 503, type: CatalogErrorResponseDto, example: { code: 'CATALOG_AI_NOT_CONFIGURED' } })
  /** multipart 입력을 제한된 text field와 안전 검사 전 upload stream으로 분리해 AI service에 전달한다. */
  async create(@Req() request: FastifyRequest) {
    const { fields, uploads } = await this.multipart(request)
    return this.ai.createJob(parseCatalogAiTextInput(fields), uploads, user(request))
  }

  @Post('edit/:catalogKey/jobs')
  @UseGuards(SameOriginGuard)
  @HttpCode(202)
  @ApiOperation({ summary: '기존 Catalog AI 수정 작업 시작', description: '현재 Catalog를 서버에서 기준안으로 읽고, 필수 수정 지시와 참고 자료로 전체 JSON 수정안을 생성합니다. 제품 키는 변경할 수 없습니다.' })
  @ApiParam({ name: 'catalogKey', example: 'example-temperature-sensor' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['revisionInstruction'], properties: { revisionInstruction: { type: 'string', minLength: 1, maxLength: 5000, example: '측정값에 소수점 한 자리 형식을 적용해 주세요.' }, referenceUrls: { type: 'string', example: '["https://example.com/manual"]' }, sessionId: { type: 'string', format: 'uuid' }, previousProposal: { type: 'string' }, files: { type: 'array', maxItems: 5, items: { type: 'string', format: 'binary' } } } } })
  @ApiAcceptedResponse({ type: CatalogAiJobAcceptedDto })
  @ApiResponse({ status: 400, type: CatalogErrorResponseDto, example: { code: 'CATALOG_AI_INVALID_INPUT', fields: ['revisionInstruction'] } })
  @ApiResponse({ status: 403, type: CatalogErrorResponseDto, example: { code: 'AUTH_INVALID_ORIGIN' } })
  async createEdit(@Param('catalogKey') catalogKey: string, @Req() request: FastifyRequest) {
    const { fields, uploads } = await this.multipart(request)
    return this.ai.createEditJob(parseCatalogKey(catalogKey), parseCatalogAiTextInput(fields), uploads, user(request))
  }

  @Get('jobs/:jobId')
  @ApiOperation({ summary: 'AI Catalog 작업 상태 조회' })
  @ApiParam({ name: 'jobId', format: 'uuid' })
  @ApiOkResponse({ type: CatalogAiJobDto })
  @ApiResponse({ status: 404, type: CatalogErrorResponseDto, example: { code: 'CATALOG_AI_JOB_NOT_FOUND' } })
  /** Frontend polling이 호출하며 소유 사용자의 공개 상태와 검토 결과만 반환한다. */
  get(@Param('jobId') jobId: string, @Req() request: FastifyRequest) {
    const job = this.ai.getJob(uuid(jobId), user(request).id)
    return { status: job.status, proposal: job.proposal, proposalDigest: job.proposalDigest, errorCode: job.errorCode }
  }

  @Delete('jobs/:jobId')
  @UseGuards(SameOriginGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'AI Catalog 작업 취소' })
  @ApiResponse({ status: 204, description: '작업이 이미 끝났어도 본문 없이 성공합니다.' })
  /** 화면 취소·이탈에서 실행 중 Gemini 요청의 AbortSignal을 중단한다. session 파일은 별도 endpoint가 정리한다. */
  cancel(@Param('jobId') jobId: string, @Req() request: FastifyRequest): Promise<void> {
    return this.ai.cancel(uuid(jobId), user(request).id)
  }

  @Delete('sessions/:sessionId')
  @UseGuards(SameOriginGuard)
  @HttpCode(204)
  @ApiOperation({ summary: 'AI Catalog 작성 세션 폐기', description: '사용자가 작성을 최종 취소할 때 임시 업로드와 Gemini Files API 자료를 정리합니다. 요청·응답 감사 DB 기록은 보존합니다.' })
  @ApiParam({ name: 'sessionId', format: 'uuid', example: '618bb694-a46a-4740-96ba-430738670ed8' })
  @ApiResponse({ status: 204, description: '세션 임시 자료를 정리했으며 응답 본문은 없습니다.' })
  @ApiResponse({ status: 400, type: CatalogErrorResponseDto, example: { code: 'CATALOG_AI_INVALID_INPUT', fields: ['id'] } })
  @ApiResponse({ status: 401, type: CatalogErrorResponseDto, example: { code: 'AUTH_UNAUTHORIZED' } })
  @ApiResponse({ status: 403, type: CatalogErrorResponseDto, example: { code: 'AUTH_INVALID_ORIGIN' } })
  @ApiResponse({ status: 404, type: CatalogErrorResponseDto, example: { code: 'CATALOG_AI_JOB_NOT_FOUND' } })
  /** 명시적 작성 취소에서만 호출하며 감사 row를 제외한 local·Gemini 임시 자료를 폐기한다. */
  discardSession(@Param('sessionId') sessionId: string, @Req() request: FastifyRequest): Promise<void> {
    return this.sessions.discardOwned(uuid(sessionId), user(request).id)
  }

  @Post('sessions/:sessionId/approve')
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: 'AI Catalog 제안 승인·등록', description: '완료 proposal을 기존 Catalog 검증 경계로 등록하고 선택한 임시 자료만 Catalog 첨부자료로 승격합니다.' })
  @ApiParam({ name: 'sessionId', format: 'uuid' })
  @ApiBody({ type: CatalogAiApprovalRequestDto })
  @ApiCreatedResponse({ type: CatalogAiApprovalResponseDto })
  @ApiResponse({ status: 409, type: CatalogErrorResponseDto, example: { code: 'CATALOG_AI_JOB_NOT_READY' } })
  /** 검토 모달 승인이 호출하며 proposal digest와 선택 자료 소유권을 재확인한 뒤 기존 Catalog 생성 경계를 사용한다. */
  approve(@Param('sessionId') sessionId: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.approval.approve(uuid(sessionId), parseCatalogAiApproval(body), user(request))
  }

  @Post('edit/:catalogKey/sessions/:sessionId/approve')
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: 'AI 수정안 승인', description: 'session에 고정된 제품 키와 기준 revision이 일치할 때만 기존 Catalog JSON을 갱신합니다.' })
  @ApiParam({ name: 'catalogKey', example: 'example-temperature-sensor' })
  @ApiParam({ name: 'sessionId', format: 'uuid' })
  @ApiBody({ type: CatalogAiEditApprovalRequestDto })
  @ApiOkResponse({ type: CatalogAiEditApprovalResponseDto })
  @ApiResponse({ status: 409, type: CatalogErrorResponseDto, example: { code: 'CATALOG_REVISION_CONFLICT' } })
  approveEdit(@Param('catalogKey') catalogKey: string, @Param('sessionId') sessionId: string, @Body() body: unknown, @Req() request: FastifyRequest) {
    return this.approval.approveEdit(parseCatalogKey(catalogKey), uuid(sessionId), parseCatalogAiEditApproval(body), user(request))
  }
}
