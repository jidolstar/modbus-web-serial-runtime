import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import type { AppConfig } from '../config/app-config'
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'
import { GeminiCatalogClient } from './gemini-catalog.client'
import { GeminiFileService } from './gemini-file.service'

const originalFetch = globalThis.fetch
afterEach(() => { globalThis.fetch = originalFetch })

function config(): AppConfig {
  return {
    nodeEnv: 'test', port: 3000, corsOrigin: 'https://app.example.com',
    database: { host: 'db', port: 3306, name: 'app', user: 'app', password: 'placeholder', ssl: false },
    auth: { jwtSecret: 'x'.repeat(32), sessionTtlSeconds: 3600, cookieName: 'session', allowedEmails: new Set(['user@example.com']) },
    google: { status: { configured: false, missing: ['GOOGLE_OIDC_CLIENT_ID', 'GOOGLE_OIDC_CLIENT_SECRET', 'GOOGLE_OIDC_CALLBACK_URL', 'AUTH_ALLOWED_EMAILS'] } },
    catalogUploads: { rootPath: 'C:\\temp', fileMaxBytes: 20 * 1024 * 1024, thumbnailMaxBytes: 10 * 1024 * 1024 },
    gemini: { configured: true, apiKey: 'placeholder-key', model: 'gemini-example', timeoutMs: 30_000, auditRetentionDays: 90 },
  }
}

describe('GeminiCatalogClient', () => {
  it('uses Backend-only key, structured output, and URL Context', async () => {
    let requestBody: Record<string, unknown> | undefined
    let requestHeaders: Headers | undefined
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      requestHeaders = new Headers(init?.headers)
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"title":"Example","definition":{},"warnings":[],"assumptions":[],"sources":[]}' }] } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }

    const appConfig = config()
    const result = await new GeminiCatalogClient(appConfig, new GeminiFileService(appConfig)).generate({ prompt: 'create', files: [], referenceUrls: ['https://example.com/manual'] }, new AbortController().signal)

    assert.equal(result.inputTokens, 10)
    assert.equal(requestHeaders?.get('x-goog-api-key'), 'placeholder-key')
    assert.deepEqual(requestBody?.tools, [{ url_context: {} }])
    assert.equal((requestBody?.generationConfig as { responseMimeType?: string }).responseMimeType, 'application/json')
    assert.equal(JSON.stringify(requestBody).includes('placeholder-key'), false)
  })

  it('maps temporary Gemini demand errors to a stable public code', async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: { code: 503, status: 'UNAVAILABLE', message: 'private provider detail' } }), { status: 503, headers: { 'Content-Type': 'application/json' } })
    await assert.rejects(
      () => { const appConfig = config(); return new GeminiCatalogClient(appConfig, new GeminiFileService(appConfig)).generate({ prompt: 'create', files: [], referenceUrls: [] }, new AbortController().signal) },
      (error: unknown) => {
        if (!(error instanceof CatalogError)) return false
        const response = error.getResponse()
        return typeof response === 'object' && response !== null && 'code' in response && response.code === CATALOG_ERROR_CODES.aiUpstreamUnavailable
      },
    )
  })

  it('uses a cached Files API URI instead of embedding base64 data', async () => {
    let requestBody: Record<string, unknown> | undefined
    globalThis.fetch = async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"title":"Example","definition":{},"warnings":[],"assumptions":[],"sources":[]}' }] } }] }), { status: 200 })
    }
    const appConfig = config()
    const client = new GeminiCatalogClient(appConfig, new GeminiFileService(appConfig))
    await client.generate({
      prompt: 'create',
      referenceUrls: [],
      files: [{
        id: 'local-file', originalName: 'manual.pdf', contentType: 'application/pdf', byteSize: 3, sha256: 'example-hash', absolutePath: 'unused-for-cached-reference',
        geminiReference: { name: 'files/example', uri: 'https://generativelanguage.googleapis.com/v1beta/files/example', mimeType: 'application/pdf', uploadedAt: Date.now() },
      }],
    }, new AbortController().signal)

    const serialized = JSON.stringify(requestBody)
    assert.equal(serialized.includes('fileData'), true)
    assert.equal(serialized.includes('inlineData'), false)
    assert.equal(serialized.includes('base64'), false)
  })
})
