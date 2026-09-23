import { describe, expect, it, vi } from 'vitest'
import catalogBundle from '@modbus-manager/device-catalog-domain/examples/cwt-th04s.bundle.json'
import { ApiDeviceCatalog } from './api-device-catalog'

describe('ApiDeviceCatalog', () => {
  it('validates and atomically loads the active Runtime snapshot', async () => {
    const request = vi.fn(async () => new Response(JSON.stringify({ items: [{ catalogKey: 'cwt-th04s', revision: 2, definition: catalogBundle }] }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    const catalog = new ApiDeviceCatalog('https://api.example.com/api', undefined, request)
    await catalog.load()
    expect(catalog.listProfiles()).toEqual([{ id: 'cwt-th04s', manufacturer: 'CWT', model: 'CWT-TH04S' }])
    expect(request).toHaveBeenCalledWith('https://api.example.com/api/runtime/catalog', expect.objectContaining({ credentials: 'include' }))
  })

  it('keeps the previous snapshot when a later response is invalid', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ catalogKey: 'cwt-th04s', revision: 1, definition: catalogBundle }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ items: [{ definition: { bundleVersion: '1.0' } }] }), { status: 200 }))
    const catalog = new ApiDeviceCatalog('https://api.example.com/api', undefined, request)
    await catalog.load()
    await expect(catalog.load()).rejects.toThrow()
    expect(catalog.getProfile('cwt-th04s').model).toBe('CWT-TH04S')
  })

  it('does not expose disabled definitions omitted by the server snapshot', async () => {
    const catalog = new ApiDeviceCatalog('https://api.example.com/api', undefined, async () => new Response(JSON.stringify({ items: [] }), { status: 200 }))
    await catalog.load()
    expect(catalog.listProfiles()).toEqual([])
  })
})
