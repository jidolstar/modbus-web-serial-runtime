import { SignJWT, jwtVerify } from 'jose'
import { SESSION_JWT_AUDIENCE, SESSION_JWT_ISSUER } from './auth.constants'

export interface SessionTokenClaims {
  readonly userId: number
  readonly email: string
  readonly jti: string
}

export class SessionTokenCodec {
  private readonly signingKey: Uint8Array

  constructor(secret: string) {
    this.signingKey = new TextEncoder().encode(secret)
  }

  async issue(
    userId: number,
    email: string,
    jti: string,
    expiresAt: Date,
  ): Promise<string> {
    return new SignJWT({ email })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(String(userId))
      .setJti(jti)
      .setIssuer(SESSION_JWT_ISSUER)
      .setAudience(SESSION_JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
      .sign(this.signingKey)
  }

  async verify(token: string, currentDate: Date = new Date()): Promise<SessionTokenClaims | undefined> {
    try {
      const { payload } = await jwtVerify(token, this.signingKey, {
        algorithms: ['HS256'],
        issuer: SESSION_JWT_ISSUER,
        audience: SESSION_JWT_AUDIENCE,
        currentDate,
      })
      if (
        typeof payload.jti !== 'string' ||
        typeof payload.sub !== 'string' ||
        typeof payload.email !== 'string'
      ) {
        return undefined
      }
      const userId = Number(payload.sub)
      if (!Number.isSafeInteger(userId) || userId <= 0) return undefined
      return { userId, email: payload.email, jti: payload.jti }
    } catch {
      return undefined
    }
  }
}
