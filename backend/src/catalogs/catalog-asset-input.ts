import { isIP } from 'node:net'
import type { CatalogDocumentType, CatalogLinkType } from '../database/database.types'
import { CATALOG_ASSET_TITLE_MAX_LENGTH, CATALOG_DOCUMENT_TYPES, CATALOG_ERROR_CODES, CATALOG_LINK_TYPES, CATALOG_LINK_URL_MAX_LENGTH } from './catalog.constants'
import { CatalogError } from './catalog.error'

export interface CatalogLinkInput {
  readonly title: string // 목록 표시 제목. 예: "제조사 제품 페이지"
  readonly linkType: CatalogLinkType // 링크 용도. 예: "official_website"
  readonly url: string // public HTTPS URL. 예: "https://example.com/products/temp-100"
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseTitle(value: unknown): string {
  const title = typeof value === 'string' ? value.trim() : ''
  if (!title || title.length > CATALOG_ASSET_TITLE_MAX_LENGTH) throw new CatalogError(CATALOG_ERROR_CODES.assetInvalidInput, 400, ['title'])
  return title
}

function isPrivateIpLiteral(hostname: string): boolean {
  const unwrapped = hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
  if (isIP(unwrapped) === 4) {
    const [first, second] = unwrapped.split('.').map(Number)
    return first === 10 || first === 127 || first === 0 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)
  }
  if (isIP(unwrapped) === 6) {
    const normalized = unwrapped.toLowerCase()
    return normalized === '::1' || normalized === '::' || normalized.startsWith('fc') || normalized.startsWith('fd') || normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
  }
  return false
}

/** 파일 upload endpoint에서 multipart text field를 제한된 문서 유형으로 변환한다. */
export function parseCatalogFileFields(fields: Readonly<Record<string, string>>): { readonly title: string; readonly documentType: CatalogDocumentType } {
  const unexpected = Object.keys(fields).filter((key) => !['title', 'documentType'].includes(key))
  if (unexpected.length > 0 || !CATALOG_DOCUMENT_TYPES.includes(fields.documentType as CatalogDocumentType)) {
    throw new CatalogError(CATALOG_ERROR_CODES.assetInvalidInput, 400, unexpected.length > 0 ? unexpected : ['documentType'])
  }
  return { title: parseTitle(fields.title), documentType: fields.documentType as CatalogDocumentType }
}

/** 링크 create/update endpoint에서 예상 필드와 public HTTPS 목적지만 허용한다. */
export function parseCatalogLinkInput(value: unknown): CatalogLinkInput {
  if (!isRecord(value)) throw new CatalogError(CATALOG_ERROR_CODES.assetInvalidInput, 400, ['body'])
  const unexpected = Object.keys(value).filter((key) => !['title', 'linkType', 'url'].includes(key))
  if (unexpected.length > 0 || !CATALOG_LINK_TYPES.includes(value.linkType as CatalogLinkType)) {
    throw new CatalogError(CATALOG_ERROR_CODES.assetInvalidInput, 400, unexpected.length > 0 ? unexpected : ['linkType'])
  }
  if (typeof value.url !== 'string' || value.url.length > CATALOG_LINK_URL_MAX_LENGTH) {
    throw new CatalogError(CATALOG_ERROR_CODES.assetInvalidInput, 400, ['url'])
  }
  let url: URL
  try { url = new URL(value.url) } catch { throw new CatalogError(CATALOG_ERROR_CODES.assetInvalidInput, 400, ['url']) }
  const hostname = url.hostname.toLowerCase()
  const forbiddenHostname = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local') || isPrivateIpLiteral(hostname)
  if (url.protocol !== 'https:' || url.username || url.password || forbiddenHostname || url.hash || url.href.length > CATALOG_LINK_URL_MAX_LENGTH) {
    throw new CatalogError(CATALOG_ERROR_CODES.assetInvalidInput, 400, ['url'])
  }
  return { title: parseTitle(value.title), linkType: value.linkType as CatalogLinkType, url: url.href }
}

/** URL의 숫자 asset ID를 안전한 양의 정수로 제한한다. */
export function parseCatalogAssetId(value: string): number {
  const id = Number(value)
  if (!Number.isSafeInteger(id) || id < 1) throw new CatalogError(CATALOG_ERROR_CODES.assetInvalidInput, 400, ['assetId'])
  return id
}
