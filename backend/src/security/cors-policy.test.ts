import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { CORS_ALLOWED_METHODS } from './cors-policy'

describe('CORS policy', () => {
  it('allows every catalog management method without exposing unrelated methods', () => {
    assert.deepEqual(CORS_ALLOWED_METHODS, ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'])
    assert.equal(CORS_ALLOWED_METHODS.includes('TRACE' as never), false)
    assert.equal(CORS_ALLOWED_METHODS.includes('CONNECT' as never), false)
  })
})
