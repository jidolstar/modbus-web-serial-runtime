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

  it('requests the selected list page with limit and offset', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ items: [], total: 24, limit: 10, offset: 10 }))
    const client = new CatalogApiClient('https://api.example.com/api', request)
    await expect(client.list('TEMP', 10, 10)).resolves.toEqual({ items: [], total: 24 })
    expect(request).toHaveBeenCalledWith('https://api.example.com/api/catalogs?limit=10&offset=10&q=TEMP', expect.anything())
  })

  it('rejects an invalid page range before sending a request', async () => {
    const request = vi.fn<typeof fetch>()
    const client = new CatalogApiClient('https://api.example.com/api', request)
    await expect(client.list('', 10, -1)).rejects.toMatchObject({ status: 400, code: 'INVALID_LIST_QUERY' })
    expect(request).not.toHaveBeenCalled()
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

  it('requires the thumbnail presence flag in Catalog summaries', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({
      items: [{
        catalogKey: 'example-sensor', title: 'Example Sensor', manufacturer: 'Example Devices', model: 'TEMP-100',
        schemaVersion: '1.0', revision: 1, enabled: true, usesExtensions: false, hasThumbnail: false,
        createdAt: '2026-09-23T00:00:00.000Z', updatedAt: '2026-09-23T00:00:00.000Z',
      }],
      total: 1,
    }))
    const client = new CatalogApiClient('https://api.example.com/api', request)
    await expect(client.list()).resolves.toMatchObject({ items: [{ hasThumbnail: false }], total: 1 })
  })

  it('normalizes a browser network failure without exposing its internal message', async () => {
    const request = vi.fn<typeof fetch>().mockRejectedValue(new Error('private proxy detail'))
    const client = new CatalogApiClient('https://api.example.com/api', request)
    const error = await client.list().catch((reason: unknown) => reason)
    expect(error).toMatchObject({ status: 0, code: 'NETWORK_ERROR' })
    expect(String(error)).not.toContain('private proxy detail')
  })
})
