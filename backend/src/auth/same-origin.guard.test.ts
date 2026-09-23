import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isAllowedRequestOrigin } from './same-origin.guard'

const allowedOrigin = 'https://app.example.com'

describe('isAllowedRequestOrigin', () => {
  it('accepts the exact Origin', () => {
    assert.equal(isAllowedRequestOrigin(allowedOrigin, undefined, allowedOrigin), true)
  })

  it('accepts a Referer from the exact origin when Origin is absent', () => {
    assert.equal(
      isAllowedRequestOrigin(undefined, `${allowedOrigin}/dashboard`, allowedOrigin),
      true,
    )
  })

  it('rejects a lookalike origin and malformed Referer', () => {
    assert.equal(
      isAllowedRequestOrigin(`${allowedOrigin}.attacker.example`, undefined, allowedOrigin),
      false,
    )
    assert.equal(isAllowedRequestOrigin(undefined, 'not-a-url', allowedOrigin), false)
  })
})
