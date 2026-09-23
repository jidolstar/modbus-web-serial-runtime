import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, it } from 'node:test'
import type sharpFactory from 'sharp'
import catalogBundle = require('@modbus-manager/device-catalog-domain/examples/cwt-th04s.bundle.json')
import { SessionService } from '../auth/session.service'
import { SessionsRepository } from '../auth/sessions.repository'
import { UsersRepository } from '../auth/users.repository'
import { loadAppConfig } from '../config/app-config'
import { createDatabase } from '../database/database.factory'

const sharp: typeof sharpFactory = require('sharp')

const runDatabaseTests = process.env.RUN_DB_INTEGRATION_TESTS === 'true'

describe('Catalog asset API integration', { skip: !runDatabaseTests }, () => {
  it('manages a thumbnail, clean file and HTTPS link behind auth and Origin checks', async () => {
    const config = loadAppConfig()
    const database = createDatabase(config.database)
    const sessionService = new SessionService(config, database, new UsersRepository(database), new SessionsRepository(database))
    const testId = randomUUID()
    const catalogKey = `asset-test-${testId}`
    const googleSubject = `asset-test-${testId}`
    const definition = JSON.parse(JSON.stringify(catalogBundle).replaceAll('cwt-th04s', catalogKey)) as object
    const session = await sessionService.issue({ subject: googleSubject, email: `asset-${testId}@example.com`, displayName: 'Asset Test', avatarUrl: null })
    const headers = { Cookie: `${config.auth.cookieName}=${session.token}`, Origin: config.corsOrigin }
    const baseUrl = `http://127.0.0.1:${config.port}/api/catalogs/${catalogKey}`

    try {
      const created = await fetch(`http://127.0.0.1:${config.port}/api/catalogs`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Asset Test Sensor', definition }),
      })
      assert.equal(created.status, 201, await created.text())

      const thumbnailForm = new FormData()
      const thumbnailBytes = await sharp({ create: { width: 20, height: 10, channels: 3, background: '#2563eb' } }).png().toBuffer()
      thumbnailForm.append('file', new Blob([thumbnailBytes], { type: 'image/png' }), 'sensor.png')
      const thumbnail = await fetch(`${baseUrl}/thumbnail`, { method: 'PUT', headers, body: thumbnailForm })
      assert.equal(thumbnail.status, 200, await thumbnail.text())
      const thumbnailResponse = await fetch(`${baseUrl}/thumbnail`, { headers: { Cookie: headers.Cookie } })
      assert.equal(thumbnailResponse.status, 200)
      assert.equal(thumbnailResponse.headers.get('content-type'), 'image/jpeg')
      assert.ok((await thumbnailResponse.arrayBuffer()).byteLength > 0)

      const fileForm = new FormData()
      fileForm.append('title', '통신 규격 메모')
      fileForm.append('documentType', 'communication_protocol')
      fileForm.append('file', new Blob(['Modbus RTU example document'], { type: 'text/plain' }), 'protocol.txt')
      const uploaded = await fetch(`${baseUrl}/files`, { method: 'POST', headers, body: fileForm })
      const uploadedText = await uploaded.text()
      assert.equal(uploaded.status, 201, uploadedText)
      const file = JSON.parse(uploadedText) as { id: number; status: string }
      assert.equal(file.status, 'clean')
      const download = await fetch(`${baseUrl}/files/${file.id}/download`, { headers: { Cookie: headers.Cookie } })
      assert.equal(download.status, 200)
      assert.equal(await download.text(), 'Modbus RTU example document')

      const link = await fetch(`${baseUrl}/links`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '제품 페이지', linkType: 'official_website', url: 'https://example.com/products/test-sensor' }),
      })
      const linkText = await link.text()
      assert.equal(link.status, 201, linkText)
      const linkBody = JSON.parse(linkText) as { id: number; url: string }
      assert.equal(linkBody.url, 'https://example.com/products/test-sensor')

      const rejectedLink = await fetch(`${baseUrl}/links`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: '내부 주소', linkType: 'reference', url: 'https://127.0.0.1/private' }),
      })
      assert.equal(rejectedLink.status, 400)

      assert.equal((await fetch(`${baseUrl}/files/${file.id}`, { method: 'DELETE', headers })).status, 204)
      assert.equal((await fetch(`${baseUrl}/links/${linkBody.id}`, { method: 'DELETE', headers })).status, 204)
    } finally {
      const thumbnail = await database.selectFrom('catalog_thumbnails').innerJoin('catalog', 'catalog.id', 'catalog_thumbnails.catalog_id').select('catalog_thumbnails.storage_key').where('catalog.catalog_key', '=', catalogKey).executeTakeFirst()
      if (thumbnail) await rm(resolve(config.catalogUploads.rootPath, thumbnail.storage_key), { force: true })
      await database.deleteFrom('catalog').where('catalog_key', '=', catalogKey).execute()
      await database.deleteFrom('users').where('google_subject', '=', googleSubject).execute()
      await database.destroy()
    }
  })
})
