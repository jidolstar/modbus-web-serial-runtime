export const AUTH_ERROR_CODES = {
  configurationIncomplete: 'AUTH_CONFIGURATION_INCOMPLETE',
  loginFailed: 'AUTH_LOGIN_FAILED',
  forbidden: 'AUTH_FORBIDDEN',
  unauthorized: 'AUTH_UNAUTHORIZED',
  invalidOrigin: 'AUTH_INVALID_ORIGIN',
} as const

export const OAUTH_TEMP_COOKIE_NAME = 'modbus_oauth'
export const OAUTH_TEMP_TTL_SECONDS = 600
export const LOGIN_RATE_LIMIT_MAX = 10
export const LOGIN_RATE_LIMIT_WINDOW = '1 minute'
export const GOOGLE_ISSUER_URL = 'https://accounts.google.com'
export const SESSION_JWT_AUDIENCE = 'modbus-manager-api'
export const SESSION_JWT_ISSUER = 'modbus-manager'
export const OAUTH_JWT_AUDIENCE = 'modbus-manager-oauth-callback'
