import type { CatalogBundle } from '@modbus-manager/device-catalog-domain'
import { parseApiBaseUrl } from '../http/api-base-url'
import { DeviceProfileValidator } from './device-profile-validator'

export interface CatalogSummary {
  readonly catalogKey: string // URL과 Profile ID로 쓰는 안정 key. 예: "example-temperature-sensor"
  readonly title: string // 관리 목록 표시 제목. 예: "Example TEMP-100 센서"
  readonly manufacturer: string // Profile에서 파생한 제조사. 예: "Example Devices"
  readonly model: string // Profile에서 파생한 모델. 예: "TEMP-100"
  readonly schemaVersion: string // CatalogBundle version. 예: "1.0"
  readonly revision: number // 낙관적 잠금 번호. 예: 3
  readonly enabled: boolean // true이면 Runtime snapshot에 포함됨
  readonly usesExtensions: boolean // capability adapter 선언 포함 여부
  readonly createdAt: string // UTC ISO 8601 생성 시각
  readonly updatedAt: string // UTC ISO 8601 수정 시각
}

export interface CatalogDetail extends CatalogSummary { readonly definition: CatalogBundle }
export interface CatalogFileItem { readonly id: number; readonly title: string; readonly documentType: string; readonly originalName: string; readonly contentType: string; readonly byteSize: number; readonly sha256: string; readonly status: 'pending' | 'clean' | 'rejected' | 'failed'; readonly createdAt: string }
export interface CatalogLinkItem { readonly id: number; readonly title: string; readonly linkType: string; readonly url: string; readonly createdAt: string; readonly updatedAt: string }
export interface CatalogLinkInput { readonly title: string; readonly linkType: string; readonly url: string }

export class CatalogApiError extends Error {
  public constructor(
    readonly status: number,
    readonly code = 'REQUEST_FAILED',
    readonly fields: readonly string[] = [],
  ) {
    super('장비 카탈로그 요청을 처리하지 못했습니다.')
    this.name = 'CatalogApiError'
  }
}

type FetchImplementation = typeof fetch
const MANAGEMENT_PATH = 'catalogs' // Catalog 관리 API의 공통 base path. 예: "/api/catalogs"

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSummary(value: unknown): CatalogSummary {
  if (!isRecord(value)
    || typeof value.catalogKey !== 'string' || typeof value.title !== 'string'
    || typeof value.manufacturer !== 'string' || typeof value.model !== 'string'
    || typeof value.schemaVersion !== 'string' || !Number.isInteger(value.revision)
    || typeof value.enabled !== 'boolean' || typeof value.usesExtensions !== 'boolean'
    || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') {
    throw new CatalogApiError(502, 'INVALID_RESPONSE')
  }
  return value as unknown as CatalogSummary
}

function parseFile(value: unknown): CatalogFileItem {
  if (!isRecord(value) || !Number.isInteger(value.id) || typeof value.title !== 'string'
    || typeof value.documentType !== 'string' || typeof value.originalName !== 'string'
    || typeof value.contentType !== 'string' || !Number.isInteger(value.byteSize)
    || typeof value.sha256 !== 'string' || !['pending', 'clean', 'rejected', 'failed'].includes(String(value.status))
    || typeof value.createdAt !== 'string') throw new CatalogApiError(502, 'INVALID_RESPONSE')
  return value as unknown as CatalogFileItem
}

function parseLink(value: unknown): CatalogLinkItem {
  if (!isRecord(value) || !Number.isInteger(value.id) || typeof value.title !== 'string'
    || typeof value.linkType !== 'string' || typeof value.url !== 'string'
    || typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') throw new CatalogApiError(502, 'INVALID_RESPONSE')
  return value as unknown as CatalogLinkItem
}

/**
 * Catalog 관리 화면이 인증 cookie를 포함해 Backend CRUD·asset API를 호출한다.
 * 응답 shape를 화면에 전달하기 전에 검사하고 서버의 내부 오류 문구는 노출하지 않는다.
 */
export class CatalogApiClient {
  private readonly apiBaseUrl: URL
  private readonly validator = new DeviceProfileValidator()

  public constructor(
    rawApiBaseUrl: string | undefined,
    // Window.fetch를 class method처럼 호출하면 Chrome에서 Illegal invocation이 발생하므로 arrow로 this binding을 제거한다.
    private readonly request: FetchImplementation = (input, init) => fetch(input, init),
  ) {
    this.apiBaseUrl = parseApiBaseUrl(rawApiBaseUrl)
  }

  public endpoint(path: string): string {
    return new URL(path.replace(/^\//, ''), this.apiBaseUrl).toString()
  }

  public async list(query = ''): Promise<{ readonly items: CatalogSummary[]; readonly total: number }> {
    const parameters = new URLSearchParams({ limit: '100', offset: '0' })
    if (query.trim()) parameters.set('q', query.trim())
    const value = await this.json(`${MANAGEMENT_PATH}?${parameters}`)
    if (!isRecord(value) || !Array.isArray(value.items) || !Number.isInteger(value.total)) throw new CatalogApiError(502, 'INVALID_RESPONSE')
    return { items: value.items.map(parseSummary), total: value.total as number }
  }

  public async get(catalogKey: string): Promise<CatalogDetail> {
    const value = await this.json(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}`)
    return this.parseDetail(value)
  }

  public async validate(title: string, definition: unknown): Promise<void> {
    await this.json(`${MANAGEMENT_PATH}/validate`, { method: 'POST', body: JSON.stringify({ title, definition }) })
  }

  public async create(title: string, definition: unknown): Promise<CatalogDetail> {
    return this.parseDetail(await this.json(MANAGEMENT_PATH, { method: 'POST', body: JSON.stringify({ title, definition }) }))
  }

  public async update(catalogKey: string, title: string, definition: unknown, revision: number): Promise<CatalogDetail> {
    return this.parseDetail(await this.json(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}`, { method: 'PUT', body: JSON.stringify({ title, definition, revision }) }))
  }

  public async updateStatus(catalogKey: string, enabled: boolean, revision: number): Promise<CatalogSummary> {
    return parseSummary(await this.json(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}/status`, { method: 'PATCH', body: JSON.stringify({ enabled, revision }) }))
  }

  public async getThumbnailBlob(catalogKey: string): Promise<Blob | null> {
    const response = await this.fetch(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}/thumbnail`)
    if (response.status === 404) return null
    if (!response.ok) throw await this.error(response)
    return response.blob()
  }

  public async replaceThumbnail(catalogKey: string, file: File): Promise<void> {
    const form = new FormData(); form.append('file', file)
    await this.json(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}/thumbnail`, { method: 'PUT', body: form }, false)
  }

  public async listFiles(catalogKey: string): Promise<CatalogFileItem[]> {
    const value = await this.json(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}/files`)
    if (!Array.isArray(value)) throw new CatalogApiError(502, 'INVALID_RESPONSE')
    return value.map(parseFile)
  }

  public async uploadFile(catalogKey: string, title: string, documentType: string, file: File): Promise<CatalogFileItem> {
    const form = new FormData(); form.append('title', title); form.append('documentType', documentType); form.append('file', file)
    return parseFile(await this.json(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}/files`, { method: 'POST', body: form }, false))
  }

  public async downloadFile(catalogKey: string, file: CatalogFileItem): Promise<Blob> {
    const response = await this.fetch(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}/files/${file.id}/download`)
    if (!response.ok) throw await this.error(response)
    return response.blob()
  }

  public async deleteFile(catalogKey: string, fileId: number): Promise<void> {
    await this.noContent(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}/files/${fileId}`, { method: 'DELETE' })
  }

  public async listLinks(catalogKey: string): Promise<CatalogLinkItem[]> {
    const value = await this.json(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}/links`)
    if (!Array.isArray(value)) throw new CatalogApiError(502, 'INVALID_RESPONSE')
    return value.map(parseLink)
  }

  public async createLink(catalogKey: string, input: CatalogLinkInput): Promise<CatalogLinkItem> {
    return parseLink(await this.json(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}/links`, { method: 'POST', body: JSON.stringify(input) }))
  }

  public async updateLink(catalogKey: string, linkId: number, input: CatalogLinkInput): Promise<CatalogLinkItem> {
    return parseLink(await this.json(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}/links/${linkId}`, { method: 'PUT', body: JSON.stringify(input) }))
  }

  public async deleteLink(catalogKey: string, linkId: number): Promise<void> {
    await this.noContent(`${MANAGEMENT_PATH}/${encodeURIComponent(catalogKey)}/links/${linkId}`, { method: 'DELETE' })
  }

  private parseDetail(value: unknown): CatalogDetail {
    const summary = parseSummary(value)
    if (!isRecord(value) || !isRecord(value.definition)) throw new CatalogApiError(502, 'INVALID_RESPONSE')
    try {
      return { ...summary, definition: this.validator.validateCatalogBundle(value.definition, 'definition') }
    } catch {
      throw new CatalogApiError(502, 'INVALID_RESPONSE')
    }
  }

  private fetch(path: string, init: RequestInit = {}): Promise<Response> {
    return this.request(this.endpoint(path), { ...init, credentials: 'include', headers: { Accept: 'application/json', ...init.headers } })
      .catch(() => {
        // 브라우저의 CORS/네트워크 오류 원문은 노출하지 않고 UI가 재시도 여부를 판단할 안정 code로 바꾼다.
        throw new CatalogApiError(0, 'NETWORK_ERROR')
      })
  }

  private async json(path: string, init: RequestInit = {}, jsonBody = true): Promise<unknown> {
    const headers = jsonBody && init.body ? { 'Content-Type': 'application/json', ...init.headers } : init.headers
    const response = await this.fetch(path, { ...init, headers })
    if (!response.ok) throw await this.error(response)
    return response.json()
  }

  private async noContent(path: string, init: RequestInit): Promise<void> {
    const response = await this.fetch(path, init)
    if (!response.ok) throw await this.error(response)
  }

  private async error(response: Response): Promise<CatalogApiError> {
    let value: unknown
    try { value = await response.json() } catch { return new CatalogApiError(response.status) }
    if (!isRecord(value)) return new CatalogApiError(response.status)
    const code = typeof value.code === 'string' && value.code.length <= 80 ? value.code : 'REQUEST_FAILED'
    const fields = Array.isArray(value.fields) ? value.fields.filter((field): field is string => typeof field === 'string').slice(0, 20) : []
    return new CatalogApiError(response.status, code, fields)
  }
}

export const catalogApi = new CatalogApiClient(import.meta.env.VITE_API_BASE_URL)
