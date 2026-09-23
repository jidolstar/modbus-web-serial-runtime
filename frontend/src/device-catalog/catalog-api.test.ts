import { describe, expect, it, vi } from 'vitest'
import { CatalogApiClient, CatalogApiError } from './catalog-api'

function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }

describe('CatalogApiClient', () => {
  it('uses the session cookie and bounded list query', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ items: [], total: 0, limit: 100, offset: 0 }))
    const client = new CatalogApiClient('https://api.example.com/api', request)
    await expect(client.list('TEMP')).resolves.toEqual({ items: [], total: 0 })
    expect(request).toHaveBeenCalledWith('https://api.example.com/api/catalogs?limit=100&offset=0&q=TEMP', expect.objectContaining({ credentials: 'include' }))
  })

  it('preserves only stable public error fields', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ code: 'CATALOG_INVALID_INPUT', fields: ['/definition/profile/id'], stack: 'hidden' }, 400))
    const client = new CatalogApiClient('https://api.example.com/api', request)
    const error = await client.list().catch((reason: unknown) => reason)
    expect(error).toBeInstanceOf(CatalogApiError)
    expect(error).toMatchObject({ status: 400, code: 'CATALOG_INVALID_INPUT', fields: ['/definition/profile/id'] })
    expect(String(error)).not.toContain('hidden')
  })

  it('rejects malformed list responses instead of rendering untrusted shapes', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ items: [{ title: '<img>' }], total: 1 }))
    const client = new CatalogApiClient('https://api.example.com/api', request)
    await expect(client.list()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('normalizes a browser network failure without exposing its internal message', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('private proxy detail'))
    const client = new CatalogApiClient('https://api.example.com/api', request)
    const error = await client.list().catch((reason: unknown) => reason)
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
    expect(String(error)).not.toContain('private proxy detail')
  })
})
