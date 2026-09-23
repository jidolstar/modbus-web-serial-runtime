import { describe, expect, it, vi } from 'vitest'
import { AuthApiError, createAuthApiClient } from './auth-api'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('auth API client', () => {
  it('uses credentialed requests and treats 401 as anonymous', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ code: 'AUTH_UNAUTHORIZED' }, 401))
    const client = createAuthApiClient('https://api.example.com/api', fetchMock)

    await expect(client.getCurrentUser()).resolves.toBeNull()
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/auth/me', {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    })
  })

  it('sends logout as an explicit JSON request', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    const client = createAuthApiClient('https://api.example.com/api', fetchMock)

    await expect(client.logout()).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/auth/logout', {
      method: 'POST',
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
  })

  it('accepts only known missing configuration names', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ configured: false, missing: ['GOOGLE_OIDC_CLIENT_SECRET'] }),
    )
    const client = createAuthApiClient('https://api.example.com/api', fetchMock)
    await expect(client.getConfiguration()).resolves.toEqual({
      configured: false,
      missing: ['GOOGLE_OIDC_CLIENT_SECRET'],
    })
  })

  it('rejects malformed backend data', async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({ configured: false, missing: ['SECRET_VALUE=exposed'] }),
    )
    const client = createAuthApiClient('https://api.example.com/api', fetchMock)
    await expect(client.getConfiguration()).rejects.toBeInstanceOf(AuthApiError)
  })

  it('rejects unsafe API base URLs', () => {
    expect(() => createAuthApiClient('http://api.example.com/api')).toThrow('HTTPS')
    expect(() => createAuthApiClient('https://user:password@api.example.com/api')).toThrow(
      'credential',
    )
  })
})
