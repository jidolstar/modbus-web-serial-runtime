import { Inject, Injectable } from '@nestjs/common'
import { Kysely, Transaction } from 'kysely'
import { DATABASE } from '../database/database.module'
import { DatabaseSchema } from '../database/database.types'
import { GoogleIdentity } from './auth.types'

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>

export interface StoredUser {
  readonly id: number
  readonly email: string
  readonly displayName: string | null
  readonly avatarUrl: string | null
}

@Injectable()
export class UsersRepository {
  constructor(@Inject(DATABASE) private readonly database: Kysely<DatabaseSchema>) {}

  async upsertGoogleUser(identity: GoogleIdentity, executor: DatabaseExecutor): Promise<StoredUser> {
    const now = new Date()
    await executor
      .insertInto('users')
      .values({
        google_subject: identity.subject,
        email: identity.email,
        display_name: identity.displayName,
        avatar_url: identity.avatarUrl,
        last_login_at: now,
        disabled_at: null,
      })
      .onDuplicateKeyUpdate({
        email: identity.email,
        display_name: identity.displayName,
        avatar_url: identity.avatarUrl,
        last_login_at: now,
      })
      .execute()

    const user = await executor
      .selectFrom('users')
      .select(['id', 'email', 'display_name', 'avatar_url'])
      .where('google_subject', '=', identity.subject)
      .where('disabled_at', 'is', null)
      .executeTakeFirst()

    if (!user) throw new Error('User upsert did not produce an active user')
    return {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      avatarUrl: user.avatar_url,
    }
  }
}
