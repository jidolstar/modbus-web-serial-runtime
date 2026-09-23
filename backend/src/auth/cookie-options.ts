import { CookieSerializeOptions } from '@fastify/cookie'

export const SESSION_COOKIE_OPTIONS: Readonly<CookieSerializeOptions> = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
}

export const OAUTH_COOKIE_OPTIONS: Readonly<CookieSerializeOptions> = {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/api/auth/google',
}
