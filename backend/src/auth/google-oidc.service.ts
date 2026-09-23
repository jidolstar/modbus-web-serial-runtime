import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common'
import { SignJWT, jwtVerify } from 'jose'
import { generators, Issuer, Client } from 'openid-client'
import { AppConfig } from '../config/app-config'
import { APP_CONFIG } from '../config/config.module'
import {
  AUTH_ERROR_CODES,
  GOOGLE_ISSUER_URL,
  OAUTH_JWT_AUDIENCE,
  OAUTH_TEMP_TTL_SECONDS,
} from './auth.constants'
import { AuthError } from './auth-error'
import { GoogleIdentity } from './auth.types'

interface OAuthTransaction {
  readonly state: string
  readonly nonce: string
  readonly codeVerifier: string
}

@Injectable()
export class GoogleOidcService {
  private readonly signingKey: Uint8Array
  private clientPromise?: Promise<Client>

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    this.signingKey = new TextEncoder().encode(config.auth.jwtSecret)
  }

  getConfigurationStatus(): AppConfig['google']['status'] {
    return this.config.google.status
  }

  async createAuthorizationRequest(): Promise<{
    readonly authorizationUrl: string
    readonly transactionToken: string
  }> {
    this.assertConfigured()
    const state = generators.state()
    const nonce = generators.nonce()
    const codeVerifier = generators.codeVerifier()
    const codeChallenge = generators.codeChallenge(codeVerifier)
    const client = await this.getClient()

    const transactionToken = await new SignJWT({ state, nonce, codeVerifier })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setAudience(OAUTH_JWT_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${OAUTH_TEMP_TTL_SECONDS}s`)
      .sign(this.signingKey)

    const authorizationUrl = client.authorizationUrl({
      scope: 'openid email profile',
      response_type: 'code',
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })
    return { authorizationUrl, transactionToken }
  }

  async completeAuthorization(
    callbackParameters: Record<string, string | string[] | undefined>,
    transactionToken: string | undefined,
  ): Promise<GoogleIdentity> {
    this.assertConfigured()
    if (!transactionToken) {
      throw new AuthError(AUTH_ERROR_CODES.loginFailed, 401)
    }

    try {
      const { payload } = await jwtVerify(transactionToken, this.signingKey, {
        algorithms: ['HS256'],
        audience: OAUTH_JWT_AUDIENCE,
      })
      const transaction = this.parseTransaction(payload)
      const client = await this.getClient()
      const tokenSet = await client.callback(this.config.google.callbackUrl, callbackParameters, {
        state: transaction.state,
        nonce: transaction.nonce,
        code_verifier: transaction.codeVerifier,
        response_type: 'code',
      })
      const claims = tokenSet.claims()

      if (
        typeof claims.sub !== 'string' ||
        typeof claims.email !== 'string' ||
        claims.email_verified !== true
      ) {
        throw new Error('Google identity is missing required verified claims')
      }

      const email = claims.email.trim().toLowerCase()
      if (!this.config.auth.allowedEmails.has(email)) {
        throw new AuthError(AUTH_ERROR_CODES.forbidden, 403)
      }

      return {
        subject: claims.sub,
        email,
        displayName: typeof claims.name === 'string' ? claims.name : null,
        avatarUrl: typeof claims.picture === 'string' ? claims.picture : null,
      }
    } catch (error: unknown) {
      if (error instanceof AuthError) throw error
      throw new AuthError(AUTH_ERROR_CODES.loginFailed, 401)
    }
  }

  private assertConfigured(): void {
    if (!this.config.google.status.configured) {
      throw new ServiceUnavailableException({
        code: AUTH_ERROR_CODES.configurationIncomplete,
        missing: this.config.google.status.missing,
      })
    }
  }

  private async getClient(): Promise<Client> {
    const google = this.getConfiguredGoogle()
    this.clientPromise ??= Issuer.discover(GOOGLE_ISSUER_URL).then(
      (issuer) =>
        new issuer.Client({
          client_id: google.clientId,
          client_secret: google.clientSecret,
          redirect_uris: [google.callbackUrl],
          response_types: ['code'],
        }),
    )
    return this.clientPromise
  }

  private getConfiguredGoogle(): {
    readonly clientId: string
    readonly clientSecret: string
    readonly callbackUrl: string
  } {
    const { clientId, clientSecret, callbackUrl } = this.config.google
    if (!clientId || !clientSecret || !callbackUrl) {
      this.assertConfigured()
      throw new Error('Google configuration status is inconsistent')
    }
    return { clientId, clientSecret, callbackUrl }
  }

  private parseTransaction(payload: Record<string, unknown>): OAuthTransaction {
    if (
      typeof payload.state !== 'string' ||
      typeof payload.nonce !== 'string' ||
      typeof payload.codeVerifier !== 'string'
    ) {
      throw new Error('Invalid OAuth transaction')
    }
    return {
      state: payload.state,
      nonce: payload.nonce,
      codeVerifier: payload.codeVerifier,
    }
  }
}
