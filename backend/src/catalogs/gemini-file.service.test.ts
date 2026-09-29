import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, it } from 'node:test'
import type { AppConfig } from '../config/app-config'
import type { CatalogAiSessionFile } from './catalog-ai.types'
import { GeminiFileService } from './gemini-file.service'

const originalFetch = globalThis.fetch
const temporaryDirectories: string[] = []
afterEach(async () => {
  globalThis.fetch = originalFetch
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

function config(): AppConfig {
  return {
    nodeEnv: 'test', port: 3000, corsOrigin: 'https://app.example.com',
    database: { host: 'db', port: 3306, name: 'app', user: 'app', password: 'placeholder', ssl: false },
    auth: { jwtSecret: 'x'.repeat(32), sessionTtlSeconds: 3600, cookieName: 'session', allowedEmails: new Set(['user@example.com']) },
    google: { status: { configured: false, missing: [] } },
    catalogUploads: { rootPath: 'C:\\temp', fileMaxBytes: 20 * 1024 * 1024, thumbnailMaxBytes: 10 * 1024 * 1024 },
    gemini: { configured: true, apiKey: 'placeholder-key', model: 'gemini-example', timeoutMs: 30_000, auditRetentionDays: 90 },
  }
}

async function binaryFile(): Promise<CatalogAiSessionFile> {
  const directory = await mkdtemp(join(tmpdir(), 'gemini-file-test-'))
  temporaryDirectories.push(directory)
  const absolutePath = join(directory, 'manual.upload')
  await writeFile(absolutePath, Buffer.from([1, 2, 3]))
  return { id: 'local-file', originalName: 'manual.pdf', contentType: 'application/pdf', byteSize: 3, sha256: 'example-hash', absolutePath }
}

describe('GeminiFileService', () => {
  it('uploads a binary once and reuses its active reference', async () => {
    const requests: string[] = []
    globalThis.fetch = async (input, init) => {
      const url = String(input); requests.push(`${init?.method ?? 'GET'} ${url}`)
      if (url.endsWith('/upload/v1beta/files')) {
        return new Response('', { status: 200, headers: { 'x-goog-upload-url': 'https://generativelanguage.googleapis.com/upload/v1beta/files?upload_id=example' } })
      }
      if (url.includes('upload_id=example')) {
        assert.deepEqual(Buffer.from(init?.body as ArrayBuffer), Buffer.from([1, 2, 3]))
        return new Response(JSON.stringify({ file: { name: 'files/example', uri: 'https://generativelanguage.googleapis.com/v1beta/files/example', mimeType: 'application/pdf', state: 'ACTIVE' } }), { status: 200 })
      }
      throw new Error(`Unexpected request: ${url}`)
    }
    const file = await binaryFile()
    const service = new GeminiFileService(config())

    const first = await service.ensureActive(file, new AbortController().signal)
    const second = await service.ensureActive(file, new AbortController().signal)

    assert.equal(first.uri, second.uri)
    assert.equal(requests.length, 2)
  })

  it('rejects an untrusted resumable upload URL', async () => {
    globalThis.fetch = async () => new Response('', { status: 200, headers: { 'x-goog-upload-url': 'https://attacker.example/upload' } })
    const file = await binaryFile()
    await assert.rejects(() => new GeminiFileService(config()).ensureActive(file, new AbortController().signal))
    assert.equal(file.geminiReference, undefined)
  })
})
