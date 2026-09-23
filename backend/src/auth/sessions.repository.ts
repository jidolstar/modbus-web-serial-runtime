import { Inject, Injectable } from '@nestjs/common'
import { Kysely, Transaction } from 'kysely'
import { DATABASE } from '../database/database.module'
import { DatabaseSchema } from '../database/database.types'
import { AuthenticatedUser } from './auth.types'

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>

@Injectable()
export class SessionsRepository {
  constructor(@Inject(DATABASE) private readonly database: Kysely<DatabaseSchema>) {}

  async create(
    userId: number,
    tokenJtiHash: string,
    expiresAt: Date,
    executor: DatabaseExecutor,
  ): Promise<void> {
    await executor
      .insertInto('auth_sessions')
      .values({
        user_id: userId,
        token_jti_hash: tokenJtiHash,
        expires_at: expiresAt,
        revoked_at: null,
        last_seen_at: null,
      })
      .execute()
  }

  async findActiveUser(tokenJtiHash: string, now: Date): Promise<AuthenticatedUser | undefined> {
    const record = await this.database
      .selectFrom('auth_sessions')
      .innerJoin('users', 'users.id', 'auth_sessions.user_id')
      .select([
        'users.id',
        'users.email',
        'users.display_name',
        'users.avatar_url',
        'auth_sessions.token_jti_hash',
      ])
      .where('auth_sessions.token_jti_hash', '=', tokenJtiHash)
      .where('auth_sessions.revoked_at', 'is', null)
      .where('auth_sessions.expires_at', '>', now)
      .where('users.disabled_at', 'is', null)
      .executeTakeFirst()

    if (!record) return undefined
    return {
      id: record.id,
      email: record.email,
      displayName: record.display_name,
      avatarUrl: record.avatar_url,
      sessionJtiHash: record.token_jti_hash,
    }
  }

  async revoke(tokenJtiHash: string): Promise<void> {
    await this.database
      .updateTable('auth_sessions')
      .set({ revoked_at: new Date() })
      .where('token_jti_hash', '=', tokenJtiHash)
      .where('revoked_at', 'is', null)
      .execute()
  }
}
