import { readdir, stat } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import { loadAppConfig } from '../config/app-config'
import { createDatabase } from '../database/database.factory'

/** 운영자가 삭제하지 않고 DB 참조와 volume 파일의 불일치만 확인하는 진단 명령이다. */
async function auditCatalogAssets(): Promise<void> {
  const config = loadAppConfig()
  const database = createDatabase(config.database)
  try {
    const [files, thumbnails] = await Promise.all([
      database.selectFrom('catalog_files').select(['storage_key', 'status']).execute(),
      database.selectFrom('catalog_thumbnails').select('storage_key').execute(),
    ])
    const referenced = new Set([
      ...files.filter((file) => file.status === 'clean').map((file) => file.storage_key),
      ...thumbnails.map((thumbnail) => thumbnail.storage_key),
    ])
    const stored = new Set<string>()
    for (const category of ['files', 'thumbnails'] as const) {
      const directory = resolve(config.catalogUploads.rootPath, category)
      try {
        for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
          if (entry.isFile()) stored.add(`${category}/${entry.name}`)
        }
      } catch { /* 아직 upload가 없으면 category 디렉터리도 존재하지 않는다. */ }
    }
    const orphanFiles = [...stored].filter((key) => !referenced.has(key))
    const missingFiles: string[] = []
    for (const key of referenced) {
      const target = resolve(config.catalogUploads.rootPath, key)
      if (!target.startsWith(`${resolve(config.catalogUploads.rootPath)}${sep}`)) continue
      try { await stat(target) } catch { missingFiles.push(key) }
    }
    console.info(JSON.stringify({ orphanFiles, missingFiles }, null, 2))
    if (orphanFiles.length > 0 || missingFiles.length > 0) process.exitCode = 1
  } finally {
    await database.destroy()
  }
}

void auditCatalogAssets().catch((error: unknown) => {
  console.error(`Catalog asset audit failed: ${error instanceof Error ? error.message : 'unknown error'}`)
  process.exitCode = 1
})
