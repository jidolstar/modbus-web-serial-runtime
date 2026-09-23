import {
  CATALOG_DEFINITION_MAX_BYTES,
  CATALOG_ERROR_CODES,
  CATALOG_LIST_DEFAULT_LIMIT,
  CATALOG_LIST_MAX_LIMIT,
  CATALOG_SEARCH_MAX_LENGTH,
  CATALOG_TITLE_MAX_LENGTH,
} from './catalog.constants'
import { CatalogError } from './catalog.error'

export interface CatalogWriteInput {
  readonly title: string // 목록에 표시할 제목. 예: "CWT 온습도 센서"
  readonly definition: unknown // 서버 Schema 검증 전의 untrusted Bundle 후보
}
export interface CatalogUpdateInput extends CatalogWriteInput {
  readonly revision: number // 클라이언트가 읽은 현재 revision. 예: 2
}
export interface CatalogStatusInput {
  readonly enabled: boolean // true이면 실행 후보로 활성화. 예: false
  readonly revision: number // 상태 변경 충돌 검사용 revision. 예: 2
}
export interface CatalogListQuery {
  readonly q?: string // 제목/key/제조사/모델 통합 검색어. 예: "CWT"
  readonly enabled?: boolean // true/false 상태 필터. 예: true
  readonly limit: number // 페이지당 개수. 예: 20
  readonly offset: number // 건너뛸 개수. 예: 0
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function rejectUnexpectedKeys(value: Record<string, unknown>, allowed: readonly string[]): void {
  const unexpected = Object.keys(value).filter((key) => !allowed.includes(key))
  if (unexpected.length > 0) throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, unexpected)
}

/** CatalogController의 등록 요청에서 title과 Bundle 후보의 외곽 구조·크기를 먼저 제한한다. */
export function parseCatalogWriteInput(value: unknown): CatalogWriteInput {
  if (!isRecord(value)) throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['body'])
  rejectUnexpectedKeys(value, ['title', 'definition'])
  const title = typeof value.title === 'string' ? value.title.trim() : ''
  if (!title || title.length > CATALOG_TITLE_MAX_LENGTH || !isRecord(value.definition)) {
    throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['title', 'definition'])
  }
  if (Buffer.byteLength(JSON.stringify(value.definition), 'utf8') > CATALOG_DEFINITION_MAX_BYTES) {
    throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 413, ['definition'])
  }
  return { title, definition: value.definition }
}

/** CatalogController의 전체 수정 요청에서 write input과 낙관적 잠금 revision을 함께 읽는다. */
export function parseCatalogUpdateInput(value: unknown): CatalogUpdateInput {
  if (!isRecord(value)) throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['body'])
  rejectUnexpectedKeys(value, ['title', 'definition', 'revision'])
  const writeInput = parseCatalogWriteInput({ title: value.title, definition: value.definition })
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 1) {
    throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['revision'])
  }
  return { ...writeInput, revision: Number(value.revision) }
}

/** CatalogController의 상태 변경 요청에서 boolean과 revision 외 입력을 거부한다. */
export function parseCatalogStatusInput(value: unknown): CatalogStatusInput {
  if (!isRecord(value)) throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['body'])
  rejectUnexpectedKeys(value, ['enabled', 'revision'])
  if (typeof value.enabled !== 'boolean' || !Number.isSafeInteger(value.revision) || Number(value.revision) < 1) {
    throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['enabled', 'revision'])
  }
  return { enabled: value.enabled, revision: Number(value.revision) }
}

/** 목록 endpoint에서 문자열 query를 제한된 검색·pagination 값으로 변환한다. */
export function parseCatalogListQuery(value: Record<string, unknown>): CatalogListQuery {
  rejectUnexpectedKeys(value, ['q', 'enabled', 'limit', 'offset'])
  const q = typeof value.q === 'string' ? value.q.trim() : undefined
  if (q && q.length > CATALOG_SEARCH_MAX_LENGTH) throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['q'])
  if (value.enabled !== undefined && value.enabled !== 'true' && value.enabled !== 'false') {
    throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['enabled'])
  }
  const limit = value.limit === undefined ? CATALOG_LIST_DEFAULT_LIMIT : Number(value.limit)
  const offset = value.offset === undefined ? 0 : Number(value.offset)
  if (!Number.isInteger(limit) || limit < 1 || limit > CATALOG_LIST_MAX_LIMIT || !Number.isInteger(offset) || offset < 0) {
    throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['limit', 'offset'])
  }
  return { q: q || undefined, enabled: value.enabled === undefined ? undefined : value.enabled === 'true', limit, offset }
}
