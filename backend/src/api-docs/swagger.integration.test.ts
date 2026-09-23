import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { loadAppConfig } from '../config/app-config'

const runIntegrationTests = process.env.RUN_DB_INTEGRATION_TESTS === 'true'

describe('Swagger integration', { skip: !runIntegrationTests }, () => {
  it('documents every current endpoint with examples and no configured secrets', async () => {
    const config = loadAppConfig()
    const response = await fetch(`http://127.0.0.1:${config.port}/api/docs-json`)
    assert.equal(response.status, 200)

    const document = await response.text()
    for (const path of [
      '/api/health',
      '/api/auth/config',
      '/api/auth/google',
      '/api/auth/google/callback',
      '/api/auth/me',
      '/api/auth/logout',
    ]) {
      assert.match(document, new RegExp(`"${path.replaceAll('/', '\\/')}"`))
    }
    assert.match(document, /"sessionCookie"/)
    assert.match(document, /"examples"/)

    for (const secret of [
      config.auth.jwtSecret,
      config.database.password,
      config.google.clientSecret,
    ]) {
      if (secret) assert.equal(document.includes(secret), false)
    }
  })
})
