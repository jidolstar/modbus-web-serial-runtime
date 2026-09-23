import { Inject, Injectable } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { Kysely } from 'kysely'
import { AppConfig } from '../config/app-config'
import { APP_CONFIG } from '../config/config.module'
import { DATABASE } from '../database/database.module'
import { DatabaseSchema } from '../database/database.types'
import { AuthenticatedUser, GoogleIdentity, PublicUser } from './auth.types'
import { SessionsRepository } from './sessions.repository'
import { SessionTokenCodec } from './session-token.codec'
import { UsersRepository } from './users.repository'

export interface IssuedSession {
  readonly token: string
  readonly expiresAt: Date
  readonly user: PublicUser
}

@Injectable()
export class SessionService {
  private readonly tokenCodec: SessionTokenCodec

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly database: Kysely<DatabaseSchema>,
    private readonly usersRepository: UsersRepository,
    private readonly sessionsRepository: SessionsRepository,
  ) {
    this.tokenCodec = new SessionTokenCodec(config.auth.jwtSecret)
  }

  async issue(identity: GoogleIdentity): Promise<IssuedSession> {
    const jti = randomUUID()
    const jtiHash = this.hashJti(jti)
    const expiresAt = new Date(Date.now() + this.config.auth.sessionTtlSeconds * 1000)

    const user = await this.database.transaction().execute(async (transaction) => {
      const storedUser = await this.usersRepository.upsertGoogleUser(identity, transaction)
      await this.sessionsRepository.create(storedUser.id, jtiHash, expiresAt, transaction)
      return storedUser
    })

    const token = await this.tokenCodec.issue(user.id, user.email, jti, expiresAt)

    return { token, expiresAt, user }
  }

  async authenticate(token: string | undefined): Promise<AuthenticatedUser | undefined> {
    if (!token) return undefined
    const claims = await this.tokenCodec.verify(token)
    if (!claims) return undefined
    const user = await this.sessionsRepository.findActiveUser(this.hashJti(claims.jti), new Date())
    if (!user || user.id !== claims.userId || user.email !== claims.email) return undefined
    return user
  }

  async revoke(tokenJtiHash: string): Promise<void> {
    await this.sessionsRepository.revoke(tokenJtiHash)
  }

  private hashJti(jti: string): string {
    return createHash('sha256').update(jti, 'utf8').digest('hex')
  }
}
