import { Inject, Injectable } from '@nestjs/common'
import { readFile } from 'node:fs/promises'
import { APP_CONFIG } from '../config/config.module'
import { AppConfig } from '../config/app-config'
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'
import type { CatalogAiSessionFile, GeminiSessionFileReference } from './catalog-ai.types'

interface GeminiFilePayload {
  readonly file?: {
    readonly name?: string
    readonly uri?: string
    readonly mimeType?: string
    readonly state?: string
    readonly error?: unknown
  }
  readonly name?: string
  readonly uri?: string
  readonly mimeType?: string
  readonly state?: string
  readonly error?: { readonly status?: string }
}

const FILES_API_ROOT = 'https://generativelanguage.googleapis.com'
const FILE_PROCESSING_POLL_MS = 500
const FILE_PROCESSING_MAX_POLLS = 120 // 큰 PDF의 provider 전처리를 최대 약 60초 기다린다.

function providerError(status: number, code?: string): CatalogError {
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') return new CatalogError(CATALOG_ERROR_CODES.aiRateLimited, 429)
  if (status === 503 || code === 'UNAVAILABLE') return new CatalogError(CATALOG_ERROR_CODES.aiUpstreamUnavailable, 503)
  if (status === 401 || status === 403 || code === 'PERMISSION_DENIED' || code === 'UNAUTHENTICATED') return new CatalogError(CATALOG_ERROR_CODES.aiAccessDenied, 502)
  return new CatalogError(CATALOG_ERROR_CODES.aiUpstreamFailed, 502)
}

function safeUploadUrl(value: string | null): string {
  if (!value) throw new CatalogError(CATALOG_ERROR_CODES.aiUpstreamFailed, 502)
  const url = new URL(value)
  if (url.protocol !== 'https:' || (url.hostname !== 'googleapis.com' && !url.hostname.endsWith('.googleapis.com'))) {
    throw new CatalogError(CATALOG_ERROR_CODES.aiUpstreamFailed, 502)
  }
  return url.toString()
}

function activeReference(payload: GeminiFilePayload): GeminiSessionFileReference | undefined {
  const file = payload.file ?? payload
  if (file?.state !== 'ACTIVE' || !file.name || !file.uri || !file.mimeType) return undefined
  return { name: file.name, uri: file.uri, mimeType: file.mimeType, uploadedAt: Date.now() }
}

function fileState(payload: GeminiFilePayload): { readonly name?: string; readonly state?: string } {
  return payload.file ?? payload
}

/**
 * GeminiCatalogClient가 사용하는 Files API upload와 수명주기를 담당한다.
 * provider 식별자는 CatalogAiSessionFile 메모리에만 저장하며 API 응답이나 감사 DB에는 전달하지 않는다.
 */
@Injectable()
export class GeminiFileService {
  public constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  /** 최초 binary 사용 시 upload하고, 같은 세션 파일의 후속 재검토에서는 기존 URI를 반환한다. */
  public async ensureActive(file: CatalogAiSessionFile, signal: AbortSignal): Promise<GeminiSessionFileReference> {
    if (file.geminiReference) return file.geminiReference
    const apiKey = this.requireApiKey()
    const start = await fetch(`${FILES_API_ROOT}/upload/v1beta/files`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
        'X-Goog-Upload-Protocol': 'resumable',
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(file.byteSize),
        'X-Goog-Upload-Header-Content-Type': file.contentType,
      },
      body: JSON.stringify({ file: { display_name: file.originalName } }),
      signal,
    })
    if (!start.ok) throw await this.toProviderError(start)

    const bytes = await readFile(file.absolutePath)
    const upload = await fetch(safeUploadUrl(start.headers.get('x-goog-upload-url')), {
      method: 'POST',
      headers: {
        'Content-Length': String(bytes.byteLength),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize',
      },
      body: bytes,
      signal,
    })
    const uploaded = await this.payload(upload)
    if (!upload.ok) throw providerError(upload.status, uploaded.error?.status)

    const uploadedFile = fileState(uploaded)
    const providerName = uploadedFile.name
    let reference = activeReference(uploaded)
    if (!providerName) throw new CatalogError(CATALOG_ERROR_CODES.aiUpstreamFailed, 502)
    try {
      if (!reference && uploadedFile.state === 'FAILED') throw new CatalogError(CATALOG_ERROR_CODES.aiUpstreamFailed, 502)
      for (let attempt = 0; !reference && attempt < FILE_PROCESSING_MAX_POLLS; attempt += 1) {
        await this.wait(signal)
        const status = await fetch(`${FILES_API_ROOT}/v1beta/${encodeURI(providerName)}`, { headers: { 'x-goog-api-key': apiKey }, signal })
        const current = await this.payload(status)
        if (!status.ok) throw providerError(status.status, current.error?.status)
        if (fileState(current).state === 'FAILED') throw new CatalogError(CATALOG_ERROR_CODES.aiUpstreamFailed, 502)
        reference = activeReference(current)
      }
      if (!reference) throw new CatalogError(CATALOG_ERROR_CODES.aiUpstreamTimeout, 504)
    } catch (error) {
      await this.deleteByName(providerName)
      throw error
    }
    file.geminiReference = reference
    return reference
  }

  /** 세션 파일 제거·승인·TTL 정리에서 호출하며 provider 장애가 local cleanup을 막지 않게 boolean만 반환한다. */
  public async delete(file: CatalogAiSessionFile): Promise<boolean> {
    const reference = file.geminiReference
    if (!reference) return true
    const deleted = await this.deleteByName(reference.name)
    if (deleted) delete file.geminiReference
    return deleted
  }

  private requireApiKey(): string {
    const apiKey = this.config.gemini.apiKey
    if (!apiKey) throw new CatalogError(CATALOG_ERROR_CODES.aiNotConfigured, 503)
    return apiKey
  }

  private async payload(response: Response): Promise<GeminiFilePayload> {
    return await response.json().catch(() => ({})) as GeminiFilePayload
  }

  private async toProviderError(response: Response): Promise<CatalogError> {
    const body = await this.payload(response)
    return providerError(response.status, body.error?.status)
  }

  private async wait(signal: AbortSignal): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(signal.reason); return }
      const onAbort = () => { clearTimeout(timer); reject(signal.reason) }
      const timer = setTimeout(() => { signal.removeEventListener('abort', onAbort); resolve() }, FILE_PROCESSING_POLL_MS)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private async deleteByName(name: string): Promise<boolean> {
    try {
      const response = await fetch(`${FILES_API_ROOT}/v1beta/${encodeURI(name)}`, {
        method: 'DELETE',
        headers: { 'x-goog-api-key': this.requireApiKey() },
        signal: AbortSignal.timeout(Math.min(this.config.gemini.timeoutMs, 30_000)),
      })
      return response.ok || response.status === 404
    } catch {
      return false
    }
  }
}
