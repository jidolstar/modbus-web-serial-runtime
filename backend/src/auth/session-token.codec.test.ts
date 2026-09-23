import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SessionTokenCodec } from './session-token.codec'

const secret = '0123456789abcdef0123456789abcdef'

describe('SessionTokenCodec', () => {
  it('issues and verifies the minimum session claims', async () => {
    const codec = new SessionTokenCodec(secret)
    const token = await codec.issue(42, 'admin@example.com', 'session-jti', new Date(Date.now() + 60_000))
    assert.deepEqual(await codec.verify(token), {
      userId: 42,
      email: 'admin@example.com',
      jti: 'session-jti',
    })
  })

  it('rejects a token signed with another key', async () => {
    const codec = new SessionTokenCodec(secret)
    const foreignCodec = new SessionTokenCodec('abcdef0123456789abcdef0123456789')
    const token = await foreignCodec.issue(42, 'admin@example.com', 'session-jti', new Date(Date.now() + 60_000))
    assert.equal(await codec.verify(token), undefined)
  })

  it('rejects an expired token', async () => {
    const codec = new SessionTokenCodec(secret)
    const expiresAt = new Date(Date.now() + 60_000)
    const token = await codec.issue(42, 'admin@example.com', 'session-jti', expiresAt)
    assert.equal(await codec.verify(token, new Date(expiresAt.getTime() + 1_000)), undefined)
  })
})
