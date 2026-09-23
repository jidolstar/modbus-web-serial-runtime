import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, it } from 'node:test'
import catalogBundle = require('@modbus-manager/device-catalog-domain/examples/cwt-th04s.bundle.json')
import { SessionService } from '../auth/session.service'
import { SessionsRepository } from '../auth/sessions.repository'
import { UsersRepository } from '../auth/users.repository'
import { loadAppConfig } from '../config/app-config'
import { createDatabase } from '../database/database.factory'

const runDatabaseTests = process.env.RUN_DB_INTEGRATION_TESTS === 'true'

describe('Catalog API integration', { skip: !runDatabaseTests }, () => {
  it('authenticates writes, rejects cross-origin and protects revision updates', async () => {
    const config = loadAppConfig()
    const database = createDatabase(config.database)
    const sessionService = new SessionService(config, database, new UsersRepository(database), new SessionsRepository(database))
    const testId = randomUUID()
    const catalogKey = `catalog-test-${testId}`
    const googleSubject = `catalog-test-${testId}`
    const definition = JSON.parse(JSON.stringify(catalogBundle).replaceAll('cwt-th04s', catalogKey)) as object
    const baseUrl = `http://127.0.0.1:${config.port}/api/catalogs`

    try {
      const anonymous = await fetch(baseUrl)
      assert.equal(anonymous.status, 401)

      const session = await sessionService.issue({
        subject: googleSubject,
        email: `catalog-test-${testId}@example.com`,
        displayName: 'Catalog Test',
        avatarUrl: null,
      })
      const authenticatedHeaders = { Cookie: `${config.auth.cookieName}=${session.token}` }
      const body = JSON.stringify({ title: 'Integration Test Sensor', definition })

      const crossOrigin = await fetch(`${baseUrl}/validate`, {
        method: 'POST', headers: { ...authenticatedHeaders, Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body,
      })
      assert.equal(crossOrigin.status, 403)

      const created = await fetch(baseUrl, {
        method: 'POST', headers: { ...authenticatedHeaders, Origin: config.corsOrigin, 'Content-Type': 'application/json' }, body,
      })
      const createdText = await created.text()
      assert.equal(created.status, 201, createdText)
      const createdBody = JSON.parse(createdText) as { catalogKey: string; revision: number }
      assert.equal(createdBody.catalogKey, catalogKey)
      assert.equal(createdBody.revision, 1)

      const list = await fetch(`${baseUrl}?q=${encodeURIComponent(catalogKey)}`, { headers: authenticatedHeaders })
      assert.equal(list.status, 200)
      assert.equal((await list.json() as { total: number }).total, 1)

      const updateBody = JSON.stringify({ title: 'Updated Integration Sensor', definition, revision: 1 })
      const updated = await fetch(`${baseUrl}/${catalogKey}`, {
        method: 'PUT', headers: { ...authenticatedHeaders, Origin: config.corsOrigin, 'Content-Type': 'application/json' }, body: updateBody,
      })
      assert.equal(updated.status, 200)
      assert.equal((await updated.json() as { revision: number }).revision, 2)

      const staleUpdate = await fetch(`${baseUrl}/${catalogKey}`, {
        method: 'PUT', headers: { ...authenticatedHeaders, Origin: config.corsOrigin, 'Content-Type': 'application/json' }, body: updateBody,
      })
      assert.equal(staleUpdate.status, 409)
      assert.deepEqual(await staleUpdate.json(), { code: 'CATALOG_REVISION_CONFLICT' })

      const disabled = await fetch(`${baseUrl}/${catalogKey}/status`, {
        method: 'PATCH',
        headers: { ...authenticatedHeaders, Origin: config.corsOrigin, 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: false, revision: 2 }),
      })
      assert.equal(disabled.status, 200)
      assert.deepEqual(
        (({ enabled, revision }) => ({ enabled, revision }))(await disabled.json() as { enabled: boolean; revision: number }),
        { enabled: false, revision: 3 },
      )

      const runtimeSnapshot = await fetch(`http://127.0.0.1:${config.port}/api/runtime/catalog`, { headers: authenticatedHeaders })
      assert.equal(runtimeSnapshot.status, 200)
      const runtimeItems = (await runtimeSnapshot.json() as { items: Array<{ catalogKey: string }> }).items
      assert.equal(runtimeItems.some((item) => item.catalogKey === catalogKey), false)
    } finally {
      await database.deleteFrom('catalog').where('catalog_key', '=', catalogKey).execute()
      await database.deleteFrom('users').where('google_subject', '=', googleSubject).execute()
      await database.destroy()
    }
  })
})
