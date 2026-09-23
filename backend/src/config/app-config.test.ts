import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { ConfigurationError, loadAppConfig } from './app-config'

const validEnvironment = {
  NODE_ENV: 'test',
  PORT: '3000',
  CORS_ORIGIN: 'https://app.example.com',
  DATABASE_HOST: 'mysql',
  DATABASE_PORT: '3306',
  DATABASE_NAME: 'modbus_manager',
  DATABASE_USER: 'modbus_app',
  DATABASE_PASSWORD: 'test_database_password',
  DATABASE_SSL: 'false',
  JWT_SECRET: 'test_jwt_secret_0123456789abcdef0123456789abcdef',
  AUTH_SESSION_TTL_SECONDS: '28800',
  AUTH_COOKIE_NAME: 'modbus_session',
  CATALOG_UPLOAD_ROOT: '/tmp/modbus-manager-test-uploads',
  CATALOG_FILE_MAX_BYTES: '20971520',
  CATALOG_THUMBNAIL_MAX_BYTES: '10485760',
}

describe('loadAppConfig', () => {
  it('reports missing Google settings without exposing values', () => {
    const config = loadAppConfig(validEnvironment)
    assert.equal(config.google.status.configured, false)
    assert.deepEqual(config.google.status.missing, [
      'GOOGLE_OIDC_CLIENT_ID',
      'GOOGLE_OIDC_CLIENT_SECRET',
      'GOOGLE_OIDC_CALLBACK_URL',
      'AUTH_ALLOWED_EMAILS',
    ])
  })

  it('normalizes allowed emails and marks Google as configured', () => {
    const config = loadAppConfig({
      ...validEnvironment,
      GOOGLE_OIDC_CLIENT_ID: 'client-id',
      GOOGLE_OIDC_CLIENT_SECRET: 'test_google_client_secret',
      GOOGLE_OIDC_CALLBACK_URL: 'https://api.example.com/api/auth/google/callback',
      AUTH_ALLOWED_EMAILS: ' Admin@Example.com, operator@example.com ',
    })
    assert.equal(config.google.status.configured, true)
    assert.deepEqual([...config.auth.allowedEmails], ['admin@example.com', 'operator@example.com'])
  })

  it('rejects an undersized JWT secret', () => {
    assert.throws(
      () => loadAppConfig({ ...validEnvironment, JWT_SECRET: 'test_short' }),
      ConfigurationError,
    )
  })

  it('rejects non-HTTPS production origins', () => {
    assert.throws(
      () =>
        loadAppConfig({
          ...validEnvironment,
          NODE_ENV: 'production',
          CORS_ORIGIN: 'http://app.example.com',
        }),
      ConfigurationError,
    )
  })

  it('rejects an invalid Catalog upload size', () => {
    assert.throws(
      () => loadAppConfig({ ...validEnvironment, CATALOG_FILE_MAX_BYTES: '0' }),
      ConfigurationError,
    )
  })
})
