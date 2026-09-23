import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import { loadAppConfig } from '../config/app-config'
import { createDatabase } from '../database/database.factory'
import { SessionService } from './session.service'
import { SessionsRepository } from './sessions.repository'
import { UsersRepository } from './users.repository'

const runDatabaseTests = process.env.RUN_DB_INTEGRATION_TESTS === 'true'

describe('authentication API integration', { skip: !runDatabaseTests }, () => {
  it('authenticates, enforces Origin, revokes, and rejects a reused session', async () => {
    const config = loadAppConfig()
    const database = createDatabase(config.database)
    const usersRepository = new UsersRepository(database)
    const sessionsRepository = new SessionsRepository(database)
    const sessionService = new SessionService(
      config,
      database,
      usersRepository,
      sessionsRepository,
    )
    const googleSubject = `phase1-test-${randomUUID()}`

    try {
      const session = await sessionService.issue({
        subject: googleSubject,
        email: 'phase1-test@example.com',
        displayName: 'Phase 1 Test',
        avatarUrl: null,
      })
      const cookie = `${config.auth.cookieName}=${session.token}`
      const baseUrl = `http://127.0.0.1:${config.port}/api`

      const storedSession = await database
        .selectFrom('auth_sessions')
        .innerJoin('users', 'users.id', 'auth_sessions.user_id')
        .select('auth_sessions.token_jti_hash')
        .where('users.google_subject', '=', googleSubject)
        .executeTakeFirstOrThrow()
      assert.equal(storedSession.token_jti_hash.length, 64)
      assert.notEqual(storedSession.token_jti_hash, session.token)

      const me = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookie } })
      assert.equal(me.status, 200)

      const crossOriginLogout = await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: 'https://attacker.example' },
      })
      assert.equal(crossOriginLogout.status, 403)
      assert.deepEqual(await crossOriginLogout.json(), { code: 'AUTH_INVALID_ORIGIN' })

      const logout = await fetch(`${baseUrl}/auth/logout`, {
        method: 'POST',
        headers: { Cookie: cookie, Origin: config.corsOrigin },
      })
      assert.equal(logout.status, 204)
      assert.match(logout.headers.get('set-cookie') ?? '', /HttpOnly/i)

      const reusedSession = await fetch(`${baseUrl}/auth/me`, { headers: { Cookie: cookie } })
      assert.equal(reusedSession.status, 401)
    } finally {
      await database.deleteFrom('users').where('google_subject', '=', googleSubject).execute()
      await database.destroy()
    }
  })
})
