const GOOGLE_CONFIGURATION_KEYS = new Set([
  'GOOGLE_OIDC_CLIENT_ID',
  'GOOGLE_OIDC_CLIENT_SECRET',
  'GOOGLE_OIDC_CALLBACK_URL',
  'AUTH_ALLOWED_EMAILS',
])

export interface AuthConfigurationStatus {
  readonly configured: boolean
  readonly missing: readonly string[]
}

export interface AuthUser {
  readonly id: number
  readonly email: string
  readonly displayName: string | null
  readonly avatarUrl: string | null
}

export class AuthApiError extends Error {
  constructor(readonly status: number) {
    super('인증 서비스 요청에 실패했습니다.')
    this.name = 'AuthApiError'
  }
}

type FetchImplementation = typeof fetch

function parseApiBaseUrl(rawValue: string | undefined): URL {
  if (!rawValue?.trim()) throw new Error('VITE_API_BASE_URL 설정이 필요합니다.')

  const url = new URL(rawValue)
  const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(isLocalDevelopment && url.protocol === 'http:')) {
    throw new Error('VITE_API_BASE_URL은 HTTPS URL이어야 합니다.')
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error('VITE_API_BASE_URL에는 credential, query 또는 fragment를 사용할 수 없습니다.')
  }
  url.pathname = `${url.pathname.replace(/\/$/, '')}/`
  return url
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseConfigurationStatus(value: unknown): AuthConfigurationStatus {
  if (!isObject(value) || typeof value.configured !== 'boolean' || !Array.isArray(value.missing)) {
    throw new AuthApiError(502)
  }
  const missing = value.missing.filter(
    (item): item is string => typeof item === 'string' && GOOGLE_CONFIGURATION_KEYS.has(item),
  )
  if (missing.length !== value.missing.length) throw new AuthApiError(502)
  return { configured: value.configured, missing }
}

function parseAuthUser(value: unknown): AuthUser {
  if (!isObject(value) || !isObject(value.user)) throw new AuthApiError(502)
  const user = value.user
  if (
    typeof user.id !== 'number' ||
    typeof user.email !== 'string' ||
    (user.displayName !== null && typeof user.displayName !== 'string') ||
    (user.avatarUrl !== null && typeof user.avatarUrl !== 'string')
  ) {
    throw new AuthApiError(502)
  }
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
  }
}

export function createAuthApiClient(
  rawApiBaseUrl: string | undefined,
  fetchImplementation: FetchImplementation = fetch,
) {
  const apiBaseUrl = parseApiBaseUrl(rawApiBaseUrl)
  const endpoint = (path: string): string => new URL(path.replace(/^\//, ''), apiBaseUrl).toString()

  return Object.freeze({
    loginUrl: endpoint('auth/google'),

    async getConfiguration(): Promise<AuthConfigurationStatus> {
      const response = await fetchImplementation(endpoint('auth/config'), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (!response.ok) throw new AuthApiError(response.status)
      return parseConfigurationStatus(await response.json())
    },

    async getCurrentUser(): Promise<AuthUser | null> {
      const response = await fetchImplementation(endpoint('auth/me'), {
        credentials: 'include',
        headers: { Accept: 'application/json' },
      })
      if (response.status === 401) return null
      if (!response.ok) throw new AuthApiError(response.status)
      return parseAuthUser(await response.json())
    },

    async logout(): Promise<void> {
      const response = await fetchImplementation(endpoint('auth/logout'), {
        method: 'POST',
        credentials: 'include',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: '{}',
      })
      if (!response.ok && response.status !== 401) throw new AuthApiError(response.status)
    },
  })
}

export const authApi = createAuthApiClient(import.meta.env.VITE_API_BASE_URL)
