import { parseCatalogLinkInput } from './catalog-asset-input'
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'

export const AI_MAX_FILES = 5
export const AI_MAX_TOTAL_FILE_BYTES = 20 * 1024 * 1024
export const AI_MAX_REQUIREMENTS_LENGTH = 10_000
export const AI_MAX_REVISION_LENGTH = 5_000
export const AI_MAX_URLS = 10

export interface CatalogAiTextInput {
  readonly requirements: string
  readonly referenceUrls: readonly string[]
  readonly revisionInstruction?: string
  readonly previousProposal?: unknown
  readonly sessionId?: string
}

function optionalJson(value: string | undefined, field: string): unknown {
  if (!value) return undefined
  try { return JSON.parse(value) } catch { throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, [field]) }
}

/** multipart text field를 길이·개수·URL 정책이 적용된 AI 입력으로 변환한다. */
export function parseCatalogAiTextInput(fields: Readonly<Record<string, string>>): CatalogAiTextInput {
  const allowed = ['requirements', 'referenceUrls', 'revisionInstruction', 'previousProposal', 'sessionId']
  const unexpected = Object.keys(fields).filter((key) => !allowed.includes(key))
  if (unexpected.length) throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, unexpected)
  const requirements = fields.requirements?.trim() ?? ''
  const revisionInstruction = fields.revisionInstruction?.trim() || undefined
  if (requirements.length > AI_MAX_REQUIREMENTS_LENGTH || (revisionInstruction?.length ?? 0) > AI_MAX_REVISION_LENGTH) {
    throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, ['requirements', 'revisionInstruction'])
  }
  const urlsValue = optionalJson(fields.referenceUrls, 'referenceUrls') ?? []
  if (!Array.isArray(urlsValue) || urlsValue.length > AI_MAX_URLS) throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, ['referenceUrls'])
  const referenceUrls = urlsValue.map((candidate) => {
    if (typeof candidate !== 'string') throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, ['referenceUrls'])
    return parseCatalogLinkInput({ title: 'AI reference', linkType: 'reference', url: candidate }).url
  })
  const sessionId = fields.sessionId?.trim() || undefined
  if (sessionId && !/^[0-9a-f-]{36}$/.test(sessionId)) throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, ['sessionId'])
  return { requirements, revisionInstruction, referenceUrls, previousProposal: optionalJson(fields.previousProposal, 'previousProposal'), sessionId }
}

/** 설명·공개 URL·세션 첨부 중 하나도 없으면 AI가 근거 없이 장비 정보를 추측하므로 요청을 거부한다. */
export function assertCatalogAiSource(input: CatalogAiTextInput, sessionFileCount: number): void {
  if (input.requirements || input.referenceUrls.length > 0 || sessionFileCount > 0) return
  throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, ['requirements', 'referenceUrls', 'files'])
}

/** 승인 body는 완료 proposal과 같은 세션 자료만 선택할 수 있도록 식별자 shape를 제한한다. */
export function parseCatalogAiApproval(value: unknown): { readonly jobId: string; readonly proposalDigest: string; readonly retainedFileIds: readonly string[]; readonly retainedUrls: readonly string[] } {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, ['body'])
  const body = value as Record<string, unknown>
  const unexpected = Object.keys(body).filter((key) => !['jobId', 'proposalDigest', 'retainedFileIds', 'retainedUrls'].includes(key))
  if (unexpected.length || typeof body.jobId !== 'string' || typeof body.proposalDigest !== 'string'
    || !Array.isArray(body.retainedFileIds) || !body.retainedFileIds.every((id) => typeof id === 'string')
    || !Array.isArray(body.retainedUrls) || !body.retainedUrls.every((url) => typeof url === 'string')) {
    throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, unexpected.length ? unexpected : ['body'])
  }
  return { jobId: body.jobId, proposalDigest: body.proposalDigest, retainedFileIds: body.retainedFileIds, retainedUrls: body.retainedUrls }
}
