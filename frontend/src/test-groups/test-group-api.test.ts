import { describe, expect, it } from 'vitest'
import { TestGroupApiClient } from './test-group-api'

describe('TestGroupApiClient', () => {
  it('runtime snapshot POST를 빈 JSON 요청으로 전송한다', async () => {
    let requestedUrl = ''
    let requestedInit: RequestInit | undefined
    const request: typeof fetch = async (input, init) => {
      requestedUrl = String(input)
      requestedInit = init
      return new Response(JSON.stringify({ code: 'EXPECTED_TEST_RESPONSE' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
    }
    const client = new TestGroupApiClient('https://api.example.com/api/', request)

    await expect(client.runtime(7)).rejects.toMatchObject({
      status: 409,
      code: 'EXPECTED_TEST_RESPONSE',
    })
    expect(requestedUrl).toBe('https://api.example.com/api/test-groups/7/runtime-snapshot')
    expect(requestedInit?.method).toBe('POST')
    expect(requestedInit?.body).toBe('{}')
    expect(new Headers(requestedInit?.headers).get('Content-Type')).toBe('application/json')
    expect(requestedInit?.credentials).toBe('include')
  })
})
