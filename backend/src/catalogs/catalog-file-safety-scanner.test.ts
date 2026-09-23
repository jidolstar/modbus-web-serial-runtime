import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { CatalogError } from './catalog.error'
import { FileSafetyScanner } from './catalog-file-safety-scanner'

describe('FileSafetyScanner', () => {
  let directory = ''
  const scanner = new FileSafetyScanner()

  beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'catalog-scanner-')) })
  afterEach(async () => { await rm(directory, { recursive: true, force: true }) })

  it('accepts UTF-8 text and returns its canonical MIME', async () => {
    const path = join(directory, 'manual.txt')
    await writeFile(path, '공개 가능한 장비 사용 설명서')
    assert.equal(await scanner.inspect(path, 'manual.txt', 'text/plain'), 'text/plain')
  })

  it('rejects an executable renamed as PDF', async () => {
    const path = join(directory, 'manual.pdf')
    await writeFile(path, Buffer.from('MZ-not-a-pdf'))
    await assert.rejects(() => scanner.inspect(path, 'manual.pdf', 'application/pdf'), CatalogError)
  })

  it('rejects a binary file disguised as UTF-8 text', async () => {
    const path = join(directory, 'manual.txt')
    await writeFile(path, Buffer.from([0xff, 0xfe, 0x00, 0x00]))
    await assert.rejects(() => scanner.inspect(path, 'manual.txt', 'text/plain'), CatalogError)
  })
})
