import { Inject, Injectable } from '@nestjs/common'
import { readFile } from 'node:fs/promises'
import { APP_CONFIG } from '../config/config.module'
import { AppConfig } from '../config/app-config'
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'
import { CATALOG_AI_INSTRUCTIONS, CATALOG_AI_OUTPUT_SCHEMA } from './catalog-ai-prompt'
import type { CatalogAiSessionFile } from './catalog-ai.types'
import { GeminiFileService } from './gemini-file.service'

interface GeminiErrorBody {
  readonly error?: { readonly code?: number; readonly status?: string; readonly message?: string }
}

interface GeminiResponse extends GeminiErrorBody {
  readonly candidates?: readonly {
    readonly finishReason?: string
    readonly content?: { readonly parts?: readonly { readonly text?: string }[] }
    readonly urlContextMetadata?: { readonly urlMetadata?: readonly { readonly retrievedUrl?: string; readonly urlRetrievalStatus?: string }[] }
  }[]
  readonly promptFeedback?: { readonly blockReason?: string }
  readonly usageMetadata?: { readonly promptTokenCount?: number; readonly candidatesTokenCount?: number }
  readonly responseId?: string
  readonly modelVersion?: string
}

export interface GeminiCatalogResult {
  readonly responseId?: string
  readonly raw: GeminiResponse
  readonly outputText: string
  readonly inputTokens?: number
  readonly outputTokens?: number
}

function mapGeminiError(status: number, code?: string): CatalogError {
  if (status === 429 || code === 'RESOURCE_EXHAUSTED') return new CatalogError(CATALOG_ERROR_CODES.aiRateLimited, 429)
  if (status === 503 || code === 'UNAVAILABLE') return new CatalogError(CATALOG_ERROR_CODES.aiUpstreamUnavailable, 503)
  if (status === 401 || status === 403 || code === 'PERMISSION_DENIED' || code === 'UNAUTHENTICATED') return new CatalogError(CATALOG_ERROR_CODES.aiAccessDenied, 502)
  if (status === 404 || code === 'NOT_FOUND') return new CatalogError(CATALOG_ERROR_CODES.aiModelUnavailable, 502)
  return new CatalogError(CATALOG_ERROR_CODES.aiUpstreamFailed, 502)
}

function outputText(response: GeminiResponse): string {
  const text = response.candidates?.[0]?.content?.parts?.map((part) => part.text ?? '').join('').trim()
  if (!text || response.promptFeedback?.blockReason) throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidResponse, 502)
  return text
}

function isTextFile(contentType: string): boolean {
  return contentType.startsWith('text/') || contentType === 'application/json'
}

/**
 * CatalogAiService가 검증된 참고 자료와 고정 지침을 Gemini GenerateContent API로 전달한다.
 * API key는 Backend header에서만 사용하고, provider 오류 본문은 안정된 공개 오류 code로 축약한다.
 */
@Injectable()
export class GeminiCatalogClient {
  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly files: GeminiFileService,
  ) {}

  /** 서버 내부 job에서 호출하며 AbortSignal로 페이지 취소와 timeout을 모두 중단한다. */
  public async generate(input: { readonly prompt: string; readonly files: readonly CatalogAiSessionFile[]; readonly referenceUrls: readonly string[] }, signal: AbortSignal): Promise<GeminiCatalogResult> {
    const apiKey = this.config.gemini.apiKey
    if (!apiKey) throw new CatalogError(CATALOG_ERROR_CODES.aiNotConfigured, 503)

    const timeout = AbortSignal.timeout(this.config.gemini.timeoutMs)
    const combinedSignal = AbortSignal.any([signal, timeout])
    try {
      const parts: Array<Record<string, unknown>> = [{ text: input.prompt }]
      for (const file of input.files) {
        if (isTextFile(file.contentType)) {
          const bytes = await readFile(file.absolutePath)
          parts.push({ text: `\n--- Reference file: ${file.originalName} ---\n${bytes.toString('utf8')}\n--- End reference file ---` })
        } else {
          const reference = await this.files.ensureActive(file, combinedSignal)
          parts.push({ fileData: { mimeType: reference.mimeType, fileUri: reference.uri } })
        }
      }
      const body: Record<string, unknown> = {
        systemInstruction: { parts: [{ text: CATALOG_AI_INSTRUCTIONS }] },
        contents: [{ role: 'user', parts }],
        generationConfig: {
          // 현재 stable/legacy GenerateContent 모델이 공통 지원하는 REST structured-output 필드다.
          responseMimeType: 'application/json',
          responseJsonSchema: CATALOG_AI_OUTPUT_SCHEMA,
        },
      }
      if (input.referenceUrls.length) body.tools = [{ url_context: {} }]

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.config.gemini.model)}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        body: JSON.stringify(body),
        signal: combinedSignal,
      })
      const result = await response.json().catch(() => ({})) as GeminiResponse
      if (!response.ok) throw mapGeminiError(response.status, result.error?.status)
      return {
        responseId: result.responseId,
        raw: result,
        outputText: outputText(result),
        inputTokens: result.usageMetadata?.promptTokenCount,
        outputTokens: result.usageMetadata?.candidatesTokenCount,
      }
    } catch (error) {
      if (combinedSignal.aborted) {
        if (signal.aborted) throw error
        throw new CatalogError(CATALOG_ERROR_CODES.aiUpstreamTimeout, 504)
      }
      if (error instanceof CatalogError) throw error
      throw new CatalogError(CATALOG_ERROR_CODES.aiUpstreamFailed, 502)
    }
  }
}
