import type { CatalogAiProposal, CatalogAiSource } from '@modbus-manager/device-catalog-domain'
import { parseApiBaseUrl } from '../http/api-base-url'
import { CatalogApiError } from './catalog-api'

export type { CatalogAiProposal, CatalogAiSource }

export interface CatalogAiFile {
  readonly id: string // AI session 안에서 파일 선택·승격에 사용하는 임의 ID
  readonly name: string // 사용자가 업로드한 원본 표시 이름
  readonly sizeBytes: number // 검토 화면에 표시하는 검증 완료 byte 크기
  readonly mimeType: string // 서버 안전 검사가 확정한 MIME type
}

export interface CatalogAiJobAccepted {
  readonly jobId: string // polling과 취소에 사용하는 사용자 소유 job ID
  readonly sessionId: string // 같은 재검토에서 Gemini 파일을 재사용하는 임시 session ID
  readonly status: 'queued'
  readonly files: readonly CatalogAiFile[]
}

export interface CatalogAiJobState {
  readonly status: 'queued' | 'generating' | 'validating' | 'completed' | 'failed' | 'cancelled'
  readonly proposal?: CatalogAiProposal
  readonly proposalDigest?: string // 승인 시 서버가 원본 proposal과 같은지 확인하는 SHA-256 digest
  readonly errorCode?: string // Backend가 허용한 안정 오류 code만 전달됨
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCatalogAiFile(value: unknown): value is CatalogAiFile {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.sizeBytes === 'number'
    && typeof value.mimeType === 'string'
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string')
}

function isValidationIssue(value: unknown): value is { readonly path: string; readonly message: string } {
  return isRecord(value) && typeof value.path === 'string' && typeof value.message === 'string'
}

function isCatalogAiProposal(value: unknown): value is CatalogAiProposal {
  return isRecord(value)
    && typeof value.title === 'string'
    && 'definition' in value
    && Array.isArray(value.warnings)
    && value.warnings.every((item) => typeof item === 'string')
    && Array.isArray(value.assumptions)
    && value.assumptions.every((item) => typeof item === 'string')
    && Array.isArray(value.sources)
    && value.sources.every((source) => isRecord(source) && typeof source.title === 'string' && typeof source.url === 'string')
    && isRecord(value.validation)
    && typeof value.validation.valid === 'boolean'
    && isStringArray(value.validation.fields)
    && Array.isArray(value.validation.issues)
    && value.validation.issues.every(isValidationIssue)
}

const CATALOG_AI_JOB_STATUSES = ['queued', 'generating', 'validating', 'completed', 'failed', 'cancelled'] as const

function isCatalogAiJobStatus(value: unknown): value is CatalogAiJobState['status'] {
  return typeof value === 'string' && CATALOG_AI_JOB_STATUSES.some((status) => status === value)
}

/**
 * AI 작성 화면이 cookie 인증된 Backend job·session API를 호출할 때 사용하는 전용 client다.
 * Gemini key와 provider file URI는 브라우저에 전달하지 않고 앱의 임의 job/session ID만 취급한다.
 */
export class CatalogAiApiClient {
  private readonly baseUrl: URL

  public constructor(
    rawBaseUrl: string | undefined,
    private readonly request: typeof fetch = (input, init) => fetch(input, init),
  ) {
    this.baseUrl = parseApiBaseUrl(rawBaseUrl)
  }

  /** 작성 화면이 최초 생성·재검토를 시작하며, 파일이 있으므로 JSON이 아닌 multipart 요청을 사용한다. */
  public async createJob(input: {
    requirements: string
    referenceUrls: readonly string[]
    files: readonly File[]
    sessionId?: string
    revisionInstruction?: string
    previousProposal?: CatalogAiProposal
  }): Promise<CatalogAiJobAccepted> {
    const form = new FormData()
    form.append('requirements', input.requirements)
    form.append('referenceUrls', JSON.stringify(input.referenceUrls))
    if (input.sessionId) form.append('sessionId', input.sessionId)
    if (input.revisionInstruction) form.append('revisionInstruction', input.revisionInstruction)
    if (input.previousProposal) form.append('previousProposal', JSON.stringify(input.previousProposal))
    for (const file of input.files) form.append('files', file)

    const value = await this.json('catalogs/ai/jobs', { method: 'POST', body: form })
    if (!isRecord(value)
      || typeof value.jobId !== 'string'
      || typeof value.sessionId !== 'string'
      || value.status !== 'queued'
      || !Array.isArray(value.files)
      || !value.files.every(isCatalogAiFile)) {
      throw new CatalogApiError(502, 'INVALID_RESPONSE')
    }
    return {
      jobId: value.jobId,
      sessionId: value.sessionId,
      status: 'queued',
      files: value.files,
    }
  }

  /** 작성 화면 polling이 호출하며 완료 전에는 상태만, 완료 뒤에는 proposal과 digest를 반환한다. */
  public async getJob(jobId: string): Promise<CatalogAiJobState> {
    const value = await this.json(`catalogs/ai/jobs/${encodeURIComponent(jobId)}`)
    if (!isRecord(value)
      || !isCatalogAiJobStatus(value.status)
      || (value.proposal !== undefined && !isCatalogAiProposal(value.proposal))
      || (value.proposalDigest !== undefined && typeof value.proposalDigest !== 'string')
      || (value.errorCode !== undefined && typeof value.errorCode !== 'string')) {
      throw new CatalogApiError(502, 'INVALID_RESPONSE')
    }
    return {
      status: value.status,
      proposal: value.proposal,
      proposalDigest: value.proposalDigest,
      errorCode: value.errorCode,
    }
  }

  /** 생성 중 사용자 취소·페이지 이탈에서 Backend AbortSignal을 중단한다. session 파일은 별도로 정리한다. */
  public async cancel(jobId: string): Promise<void> {
    await this.noContent(`catalogs/ai/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' })
  }

  /** 최종 작성 취소에서 서버 임시 session과 Gemini file reference를 폐기한다. 감사 row는 유지된다. */
  public async discardSession(sessionId: string): Promise<void> {
    await this.noContent(`catalogs/ai/sessions/${encodeURIComponent(sessionId)}`, { method: 'DELETE' })
  }

  /** 검토 모달 승인이 호출하며 digest·선택 자료를 보내 검증된 Catalog와 영구 asset을 생성한다. */
  public async approve(sessionId: string, input: {
    jobId: string
    proposalDigest: string
    retainedFileIds: readonly string[]
    retainedUrls: readonly string[]
  }): Promise<{ catalogKey: string; revision: number }> {
    const value = await this.json(`catalogs/ai/sessions/${encodeURIComponent(sessionId)}/approve`, {
      method: 'POST',
      body: JSON.stringify(input),
      headers: { 'Content-Type': 'application/json' },
    })
    if (!isRecord(value) || typeof value.catalogKey !== 'string' || !Number.isInteger(value.revision)) {
      throw new CatalogApiError(502, 'INVALID_RESPONSE')
    }
    return { catalogKey: value.catalogKey, revision: Number(value.revision) }
  }

  /** 모든 요청에 session cookie를 포함하고 network 원문 대신 안정된 client 오류로 바꾼다. */
  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    return this.request(new URL(path, this.baseUrl), {
      ...init,
      credentials: 'include',
      headers: { Accept: 'application/json', ...init.headers },
    }).catch(() => {
      throw new CatalogApiError(0, 'NETWORK_ERROR')
    })
  }

  private async json(path: string, init: RequestInit = {}): Promise<unknown> {
    const response = await this.fetch(path, init)
    if (!response.ok) throw await this.error(response)
    return response.json()
  }

  private async noContent(path: string, init: RequestInit): Promise<void> {
    const response = await this.fetch(path, init)
    if (!response.ok) throw await this.error(response)
  }

  /** Backend 오류 body에서 공개 code만 읽고 stack·provider 상세 같은 나머지 필드는 버린다. */
  private async error(response: Response): Promise<CatalogApiError> {
    let value: unknown
    try {
      value = await response.json()
    } catch {
      return new CatalogApiError(response.status)
    }
    const code = isRecord(value) && typeof value.code === 'string' ? value.code : 'REQUEST_FAILED'
    return new CatalogApiError(response.status, code)
  }
}

export const catalogAiApi = new CatalogAiApiClient(import.meta.env.VITE_API_BASE_URL)
