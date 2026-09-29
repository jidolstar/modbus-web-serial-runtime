import { createHash, randomUUID } from 'node:crypto'
import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import type { Readable } from 'node:stream'
import { APP_CONFIG } from '../config/config.module'
import { AppConfig } from '../config/app-config'
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'
import { CatalogValidationService } from './catalog-validation.service'
import { CATALOG_AI_INSTRUCTIONS, CATALOG_AI_PROMPT_VERSION } from './catalog-ai-prompt'
import { CatalogAiRequestRepository } from './catalog-ai-request.repository'
import { CatalogAiSessionService } from './catalog-ai-session.service'
import type { CatalogAiJob, CatalogAiProposal, CatalogAiSource } from './catalog-ai.types'
import { assertCatalogAiSource, type CatalogAiTextInput } from './catalog-ai-input'
import { GeminiCatalogClient } from './gemini-catalog.client'
import { parseCatalogLinkInput } from './catalog-asset-input'
import { CatalogRepository, type CatalogAiExampleRow } from './catalog.repository'
import { RecipeSchemaVersion, type CatalogBundle } from '@modbus-manager/device-catalog-domain'

export interface CatalogAiUpload { readonly stream: Readable; readonly filename: string; readonly mimetype: string }
export interface CatalogAiJobAccepted {
  readonly jobId: string
  readonly sessionId: string
  readonly status: 'queued'
  readonly files: readonly { readonly id: string; readonly name: string; readonly sizeBytes: number; readonly mimeType: string }[]
}
const JOB_TTL_MS = 15 * 60 * 1_000
const USER_JOB_WINDOW_MS = 60 * 60 * 1_000
const USER_JOB_LIMIT = 10
const AI_EXAMPLE_CANDIDATE_LIMIT = 20 // DB 전체를 prompt 준비 때문에 읽지 않도록 제한한다.
const AI_EXAMPLE_MAX_COUNT = 3 // 실제 예시는 형태가 다른 소수만 보내 token 사용량을 제한한다.
const AI_EXAMPLE_MAX_BYTES = 64 * 1024

export interface CatalogAiExample { readonly catalogKey: string; readonly title: string; readonly definition: CatalogBundle }

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function errorCode(error: unknown): string {
  if (error instanceof CatalogError) {
    const body = error.getResponse()
    if (isRecord(body) && typeof body.code === 'string') return body.code
  }
  return CATALOG_ERROR_CODES.aiUpstreamFailed
}

function parseExample(row: CatalogAiExampleRow, validator: CatalogValidationService): CatalogAiExample | undefined {
  try {
    const raw: unknown = typeof row.definition_json === 'string' ? JSON.parse(row.definition_json) : row.definition_json
    const definition = validator.validate(raw)
    // 과거 호환용 legacy output은 유효한 DB 자료여도 신규 AI 계약의 예시로 사용하지 않는다.
    if (definition.recipes.some((recipe) => recipe.outputs?.some((output) => !('decode' in output)))) return undefined
    return {
      catalogKey: row.catalog_key,
      title: row.title,
      definition: {
        ...definition,
        recipes: definition.recipes.map((recipe) => ({ ...recipe, schemaVersion: RecipeSchemaVersion.Version2 })),
      },
    }
  } catch {
    // 과거 데이터가 현재 Schema와 맞지 않으면 잘못된 예시를 보내지 않고 제외한다.
    return undefined
  }
}

function exampleSignature(example: CatalogAiExample): string {
  const references = example.definition.profile.recipes
  const measurementCount = references.measurements?.length ?? 0
  return [
    references.actions?.length ? 'actions' : 'no-actions',
    references.changeSlaveId || references.changeBaudRate ? 'config' : 'no-config',
    measurementCount > 1 ? 'multi-measurement' : 'single-measurement',
    example.definition.recipes.some((recipe) => recipe.outputs?.some((output) => 'decode' in output && !['uint16', 'int16'].includes(output.decode.type))) ? 'advanced-output' : 'basic-output',
  ].join(':')
}

/** 활성 Catalog 후보에서 구조가 다른 예시를 최대 3개·64KiB로 선별한다. */
export function selectCatalogAiExamples(rows: readonly CatalogAiExampleRow[], validator: CatalogValidationService): readonly CatalogAiExample[] {
  const candidates = rows.map((row) => parseExample(row, validator)).filter((example): example is CatalogAiExample => example !== undefined)
  const selected: CatalogAiExample[] = []
  const signatures = new Set<string>()
  let totalBytes = 0
  const tryAdd = (example: CatalogAiExample): boolean => {
    const bytes = Buffer.byteLength(JSON.stringify(example), 'utf8')
    if (selected.length >= AI_EXAMPLE_MAX_COUNT || totalBytes + bytes > AI_EXAMPLE_MAX_BYTES) return false
    selected.push(example)
    totalBytes += bytes
    return true
  }
  for (const example of candidates) {
    const signature = exampleSignature(example)
    if (!signatures.has(signature) && tryAdd(example)) signatures.add(signature)
  }
  for (const example of candidates) if (!selected.includes(example)) tryAdd(example)
  return selected
}

function previousValidationIssues(previousProposal: unknown): readonly { readonly path: string; readonly message: string }[] {
  if (!isRecord(previousProposal) || !isRecord(previousProposal.validation) || !Array.isArray(previousProposal.validation.issues)) return []
  return previousProposal.validation.issues
    .filter((issue): issue is Record<string, unknown> => isRecord(issue))
    .filter((issue) => typeof issue.path === 'string' && typeof issue.message === 'string')
    .slice(0, 20)
    .map((issue) => ({ path: String(issue.path), message: String(issue.message) }))
}

/** 최초 생성과 재검토가 같은 최신 계약을 사용하며, 재검토에서는 서버 오류 전체를 필수 완료 조건으로 전달한다. */
export function buildCatalogAiPrompt(input: CatalogAiTextInput, examples: readonly CatalogAiExample[]): string {
  const validationIssues = previousValidationIssues(input.previousProposal)
  return JSON.stringify({
    task: input.revisionInstruction ? 'Revise the prior proposal and return the complete corrected proposal' : 'Create a new CatalogBundle proposal',
    mandatoryContract: {
      recipeSchemaVersion: 'Every recipe must use exactly 2.0',
      outputShape: 'Only v2 output is allowed: source object, decode object, optional transform object, and format object',
      acceptance: 'The complete definition must satisfy the supplied response schema and all application validation issues before it is returned',
    },
    requirements: input.requirements,
    referenceUrls: input.referenceUrls,
    revision: input.revisionInstruction ? {
      userInstruction: input.revisionInstruction,
      serverValidationIssues: validationIssues,
      acceptanceCriteria: [
        'Correct every serverValidationIssues entry; none may be ignored or preserved',
        'Return the entire corrected proposal rather than a patch or explanation',
        'After corrections, re-check recipe IDs, profile references, parameter references, maps, ranges, and every output shape',
      ],
    } : null,
    previousProposal: input.previousProposal ?? null,
    validCatalogExamples: examples,
    examplePolicy: 'Examples are enabled, server-validated, current-v2 references for structure only. Never copy device-specific addresses, ranges, maps, IDs, or values unless the current source documents independently support them.',
  })
}

/** Gemini 구조화 응답을 application proposal로 바꾸며, 저장할 수 없는 AI 출처만 안전하게 제외한다. */
export function parseCatalogAiEnvelope(text: string): Omit<CatalogAiProposal, 'validation'> {
  let value: unknown
  try { value = JSON.parse(text) } catch { throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidResponse, 502) }
  if (!isRecord(value) || typeof value.title !== 'string' || !isRecord(value.definition)
    || !Array.isArray(value.warnings) || !value.warnings.every((item) => typeof item === 'string')
    || !Array.isArray(value.assumptions) || !value.assumptions.every((item) => typeof item === 'string') || !Array.isArray(value.sources)) {
    throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidResponse, 502)
  }
  const definition: unknown = value.definition
  const warnings = [...value.warnings]
  const sources: CatalogAiSource[] = []
  for (const source of value.sources) {
    if (!isRecord(source) || typeof source.title !== 'string' || typeof source.url !== 'string') throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidResponse, 502)
    try {
      const parsed = parseCatalogLinkInput({ title: source.title || 'AI source', linkType: 'reference', url: source.url })
      sources.push({ title: parsed.title, url: parsed.url })
    } catch (error) {
      if (!(error instanceof CatalogError)) throw error
      // 첨부 PDF만 사용한 생성에서는 모델이 file 이름을 URL처럼 반환할 수 있다. 출처만 제외하고 JSON 검토는 계속한다.
      warnings.push(`유효한 public HTTPS 주소가 아닌 AI 참고 출처를 제외했습니다: ${source.title || '제목 없음'}`)
    }
  }
  return { title: value.title.trim(), definition, warnings, assumptions: value.assumptions, sources }
}

/** Controller의 생성 요청을 비동기 Gemini 작업으로 실행하고 검증된 proposal 상태를 보관한다. */
@Injectable()
export class CatalogAiService implements OnModuleInit, OnModuleDestroy {
  private readonly jobs = new Map<string, CatalogAiJob>()
  private readonly abortControllers = new Map<string, AbortController>()
  private readonly userRequestTimes = new Map<number, number[]>()
  private cleanupTimer?: NodeJS.Timeout
  private lastAuditCleanupAt = 0

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessions: CatalogAiSessionService,
    private readonly client: GeminiCatalogClient,
    private readonly audit: CatalogAiRequestRepository,
    private readonly validator: CatalogValidationService,
    private readonly catalogs: CatalogRepository,
  ) {}

  public onModuleInit(): void {
    this.cleanupTimer = setInterval(() => {
      void this.cleanup()
    }, 60_000)
    this.cleanupTimer.unref()
  }
  /** Nest 종료 시 cleanup timer만 해제한다. session service가 임시 directory의 다음 시작 정리를 담당한다. */
  public onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
  }

  /** 생성 endpoint에서 파일을 세션에 보관한 뒤 즉시 반환할 queued job을 만든다. */
  public async createJob(
    input: CatalogAiTextInput,
    uploads: readonly CatalogAiUpload[],
    user: { readonly id: number; readonly email: string },
  ): Promise<CatalogAiJobAccepted> {
    if (!this.config.gemini.configured) throw new CatalogError(CATALOG_ERROR_CODES.aiNotConfigured, 503)
    this.enforceRateLimit(user.id)
    const session = input.sessionId ? this.sessions.require(input.sessionId, user.id) : this.sessions.create(user.id)
    try {
      for (const upload of uploads) {
        await this.sessions.addFile(
          session,
          upload.stream,
          upload.filename,
          upload.mimetype,
          this.config.catalogUploads.fileMaxBytes,
        )
      }
      // 재검토에서는 기존 session 파일도 입력 근거이므로 새 upload 개수가 아닌 전체 session 파일로 판정한다.
      assertCatalogAiSource(input, this.sessions.list(session).length)
    } catch (error) {
      if (!input.sessionId) await this.sessions.discard(session.id, user.id)
      throw error
    }
    const jobId = randomUUID()
    const job: CatalogAiJob = { id: jobId, sessionId: session.id, ownerUserId: user.id, requesterEmail: user.email, createdAt: Date.now(), status: 'queued' }
    this.jobs.set(jobId, job)
    const controller = new AbortController()
    this.abortControllers.set(jobId, controller)
    void this.execute(job, input, controller.signal)
    return {
      jobId,
      sessionId: session.id,
      status: 'queued',
      files: this.sessions.list(session).map((file) => ({
        id: file.id,
        name: file.originalName,
        sizeBytes: file.byteSize,
        mimeType: file.contentType,
      })),
    }
  }

  /** polling·취소·승인이 호출하며 다른 사용자의 job 존재 여부를 같은 404로 숨긴다. */
  public getJob(jobId: string, userId: number): CatalogAiJob {
    const job = this.jobs.get(jobId)
    if (!job || job.ownerUserId !== userId) throw new CatalogError(CATALOG_ERROR_CODES.aiJobNotFound, 404)
    return job
  }

  /** 사용자 취소가 실행 중 요청을 중단한다. 완료 상태는 idempotent하게 그대로 둔다. */
  public async cancel(jobId: string, userId: number): Promise<void> {
    const job = this.getJob(jobId, userId)
    if (['completed', 'failed', 'cancelled'].includes(job.status)) return
    job.status = 'cancelled'
    this.abortControllers.get(jobId)?.abort()
  }

  /** queued job이 background에서 호출하며 감사 row 생성 후에만 Gemini 요청과 Catalog 검증을 수행한다. */
  private async execute(job: CatalogAiJob, input: CatalogAiTextInput, signal: AbortSignal): Promise<void> {
    const startedAt = Date.now()
    const session = this.sessions.require(job.sessionId, job.ownerUserId)
    const files = this.sessions.list(session)
    let upstreamResponse: unknown
    const attachments = files.map((file) => ({ source: 'session_upload', sourceId: file.id, name: file.originalName, sizeBytes: file.byteSize, mimeType: file.contentType }))
    let prompt = ''
    try {
      const exampleRows = await this.catalogs.listEnabledAiExamples(AI_EXAMPLE_CANDIDATE_LIMIT)
      const examples = selectCatalogAiExamples(exampleRows, this.validator)
      prompt = buildCatalogAiPrompt(input, examples)
      const requestPayload = { instructions: CATALOG_AI_INSTRUCTIONS, prompt, exampleCatalogKeys: examples.map((example) => example.catalogKey) }
      await this.audit.start({ jobId: job.id, requesterEmail: job.requesterEmail, requestKind: input.revisionInstruction ? 'review' : 'generate', model: this.config.gemini.model, promptVersion: CATALOG_AI_PROMPT_VERSION, requestPayload, attachments })
    } catch {
      // 실제 Gemini 요청보다 감사 row 생성을 먼저 보장해 추적되지 않는 외부 호출을 만들지 않는다.
      job.status = 'failed'
      job.errorCode = CATALOG_ERROR_CODES.aiAuditFailed
      return
    }
    try {
      job.status = 'generating'
      const result = await this.client.generate({ prompt, files, referenceUrls: input.referenceUrls }, signal)
      upstreamResponse = result.raw
      job.upstreamResponseId = result.responseId
      if (signal.aborted) return
      job.status = 'validating'
      const parsed = parseCatalogAiEnvelope(result.outputText)
      const sources = [...parsed.sources]
      for (const url of input.referenceUrls) if (!sources.some((source) => source.url === url)) sources.push({ title: '사용자 참고 URL', url })
      const envelope = { ...parsed, sources }
      const issues = this.validator.inspect(envelope.definition)
      const fields = [...new Set(issues.map(({ path }) => path))]
      const proposal: CatalogAiProposal = { ...envelope, validation: { valid: issues.length === 0, fields, issues } }
      job.proposal = proposal
      job.proposalDigest = createHash('sha256').update(JSON.stringify(proposal)).digest('hex')
      job.status = 'completed'
      await this.audit.finish(job.id, { status: 'completed', response: result.raw, upstreamResponseId: result.responseId, inputTokens: result.inputTokens, outputTokens: result.outputTokens, durationMs: Date.now() - startedAt })
    } catch (error) {
      const cancelled = signal.aborted || job.status === 'cancelled'
      job.status = cancelled ? 'cancelled' : 'failed'
      job.errorCode = cancelled ? undefined : errorCode(error)
      await this.audit.finish(job.id, { status: cancelled ? 'cancelled' : 'failed', response: upstreamResponse, upstreamResponseId: job.upstreamResponseId, errorCode: job.errorCode, errorDetail: error instanceof Error ? error.name : 'unknown', durationMs: Date.now() - startedAt }).catch(() => undefined)
    } finally {
      this.abortControllers.delete(job.id)
    }
  }

  private async cleanup(): Promise<void> {
    const cutoff = Date.now() - JOB_TTL_MS
    for (const [id, job] of this.jobs) if (job.createdAt < cutoff && ['completed', 'failed', 'cancelled'].includes(job.status)) this.jobs.delete(id)
    if (Date.now() - this.lastAuditCleanupAt >= 86_400_000) {
      this.lastAuditCleanupAt = Date.now()
      const auditCutoff = new Date(Date.now() - this.config.gemini.auditRetentionDays * 86_400_000)
      await this.audit.deleteExpired(auditCutoff).catch(() => 0)
    }
  }

  private enforceRateLimit(userId: number): void {
    if ([...this.jobs.values()].some((job) => job.ownerUserId === userId && ['queued', 'generating', 'validating'].includes(job.status))) {
      throw new CatalogError(CATALOG_ERROR_CODES.aiRateLimited, 429)
    }
    const cutoff = Date.now() - USER_JOB_WINDOW_MS
    const recent = (this.userRequestTimes.get(userId) ?? []).filter((time) => time >= cutoff)
    if (recent.length >= USER_JOB_LIMIT) throw new CatalogError(CATALOG_ERROR_CODES.aiRateLimited, 429)
    recent.push(Date.now()); this.userRequestTimes.set(userId, recent)
  }
}
