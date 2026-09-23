const DEFAULT_SESSION_TTL_SECONDS = 28_800
const MIN_SESSION_TTL_SECONDS = 300
const MAX_SESSION_TTL_SECONDS = 86_400
const MIN_JWT_SECRET_BYTES = 32
const DEFAULT_CATALOG_FILE_MAX_BYTES = 20 * 1024 * 1024
const DEFAULT_CATALOG_THUMBNAIL_MAX_BYTES = 10 * 1024 * 1024
const DEFAULT_CATALOG_UPLOAD_ROOT = '/var/lib/modbus-manager/catalog-uploads'

export const GOOGLE_CONFIGURATION_KEYS = [
  'GOOGLE_OIDC_CLIENT_ID',
  'GOOGLE_OIDC_CLIENT_SECRET',
  'GOOGLE_OIDC_CALLBACK_URL',
  'AUTH_ALLOWED_EMAILS',
] as const

export type GoogleConfigurationKey = (typeof GOOGLE_CONFIGURATION_KEYS)[number]

export interface GoogleOidcConfigurationStatus {
  readonly configured: boolean
  readonly missing: readonly GoogleConfigurationKey[]
}

export interface AppConfig {
  readonly nodeEnv: 'development' | 'test' | 'production'
  readonly port: number
  readonly corsOrigin: string
  readonly database: {
    readonly host: string
    readonly port: number
    readonly name: string
    readonly user: string
    readonly password: string
    readonly ssl: boolean
  }
  readonly auth: {
    readonly jwtSecret: string
    readonly sessionTtlSeconds: number
    readonly cookieName: string
    readonly allowedEmails: ReadonlySet<string>
  }
  readonly google: {
    readonly clientId?: string
    readonly clientSecret?: string
    readonly callbackUrl?: string
    readonly status: GoogleOidcConfigurationStatus
  }
  readonly catalogUploads: {
    readonly rootPath: string // Backend 전용 volume의 절대 경로. 예: "/var/lib/modbus-manager/catalog-uploads"
    readonly fileMaxBytes: number // 일반 참고 파일의 최대 크기. 예: 20971520
    readonly thumbnailMaxBytes: number // 썸네일 원본의 최대 크기. 예: 10485760
  }
}

type Environment = Readonly<Record<string, string | undefined>>

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

function required(env: Environment, key: string): string {
  const value = env[key]?.trim()
  if (!value) {
    throw new ConfigurationError(`${key} is required`)
  }
  return value
}

function parseInteger(
  env: Environment,
  key: string,
  defaultValue: number,
  minimum: number,
  maximum: number,
): number {
  const rawValue = env[key]?.trim()
  const value = rawValue ? Number(rawValue) : defaultValue
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new ConfigurationError(`${key} must be an integer from ${minimum} to ${maximum}`)
  }
  return value
}

function parseBoolean(env: Environment, key: string, defaultValue: boolean): boolean {
  const rawValue = env[key]?.trim().toLowerCase()
  if (!rawValue) return defaultValue
  if (rawValue === 'true') return true
  if (rawValue === 'false') return false
  throw new ConfigurationError(`${key} must be true or false`)
}

function parseUrl(value: string, key: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new ConfigurationError(`${key} must be a valid URL`)
  }
}

function normalizeAllowedEmails(rawValue: string | undefined): ReadonlySet<string> {
  return new Set(
    (rawValue ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean),
  )
}

function parseCookieName(env: Environment): string {
  const cookieName = required(env, 'AUTH_COOKIE_NAME')
  if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(cookieName)) {
    throw new ConfigurationError('AUTH_COOKIE_NAME contains invalid characters')
  }
  return cookieName
}

export function loadAppConfig(env: Environment = process.env): AppConfig {
  const nodeEnvValue = env.NODE_ENV?.trim() || 'development'
  if (!['development', 'test', 'production'].includes(nodeEnvValue)) {
    throw new ConfigurationError('NODE_ENV must be development, test, or production')
  }
  const nodeEnv = nodeEnvValue as AppConfig['nodeEnv']

  const corsOrigin = required(env, 'CORS_ORIGIN')
  const corsUrl = parseUrl(corsOrigin, 'CORS_ORIGIN')
  if (corsUrl.origin !== corsOrigin || !['http:', 'https:'].includes(corsUrl.protocol)) {
    throw new ConfigurationError('CORS_ORIGIN must be one exact HTTP(S) origin')
  }

  const jwtSecret = required(env, 'JWT_SECRET')
  if (Buffer.byteLength(jwtSecret, 'utf8') < MIN_JWT_SECRET_BYTES) {
    throw new ConfigurationError(`JWT_SECRET must contain at least ${MIN_JWT_SECRET_BYTES} bytes`)
  }

  const callbackUrl = env.GOOGLE_OIDC_CALLBACK_URL?.trim() || undefined
  const callback = callbackUrl ? parseUrl(callbackUrl, 'GOOGLE_OIDC_CALLBACK_URL') : undefined
  if (nodeEnv === 'production') {
    if (corsUrl.protocol !== 'https:') {
      throw new ConfigurationError('CORS_ORIGIN must use HTTPS in production')
    }
    if (callback && callback.protocol !== 'https:') {
      throw new ConfigurationError('GOOGLE_OIDC_CALLBACK_URL must use HTTPS in production')
    }
  }

  const allowedEmails = normalizeAllowedEmails(env.AUTH_ALLOWED_EMAILS)
  const googleValues: Record<GoogleConfigurationKey, string | undefined> = {
    GOOGLE_OIDC_CLIENT_ID: env.GOOGLE_OIDC_CLIENT_ID?.trim() || undefined,
    GOOGLE_OIDC_CLIENT_SECRET: env.GOOGLE_OIDC_CLIENT_SECRET?.trim() || undefined,
    GOOGLE_OIDC_CALLBACK_URL: callbackUrl,
    AUTH_ALLOWED_EMAILS: allowedEmails.size > 0 ? 'configured' : undefined,
  }
  const missing = GOOGLE_CONFIGURATION_KEYS.filter((key) => !googleValues[key])

  return {
    nodeEnv,
    port: parseInteger(env, 'PORT', 3000, 1, 65_535),
    corsOrigin,
    database: {
      host: required(env, 'DATABASE_HOST'),
      port: parseInteger(env, 'DATABASE_PORT', 3306, 1, 65_535),
      name: required(env, 'DATABASE_NAME'),
      user: required(env, 'DATABASE_USER'),
      password: required(env, 'DATABASE_PASSWORD'),
      ssl: parseBoolean(env, 'DATABASE_SSL', false),
    },
    auth: {
      jwtSecret,
      sessionTtlSeconds: parseInteger(
        env,
        'AUTH_SESSION_TTL_SECONDS',
        DEFAULT_SESSION_TTL_SECONDS,
        MIN_SESSION_TTL_SECONDS,
        MAX_SESSION_TTL_SECONDS,
      ),
      cookieName: parseCookieName(env),
      allowedEmails,
    },
    google: {
      clientId: googleValues.GOOGLE_OIDC_CLIENT_ID,
      clientSecret: googleValues.GOOGLE_OIDC_CLIENT_SECRET,
      callbackUrl,
      status: { configured: missing.length === 0, missing },
    },
    catalogUploads: {
      rootPath: env.CATALOG_UPLOAD_ROOT?.trim() || DEFAULT_CATALOG_UPLOAD_ROOT,
      fileMaxBytes: parseInteger(env, 'CATALOG_FILE_MAX_BYTES', DEFAULT_CATALOG_FILE_MAX_BYTES, 1_024, 100 * 1024 * 1024),
      thumbnailMaxBytes: parseInteger(env, 'CATALOG_THUMBNAIL_MAX_BYTES', DEFAULT_CATALOG_THUMBNAIL_MAX_BYTES, 1_024, 25 * 1024 * 1024),
    },
  }
}
