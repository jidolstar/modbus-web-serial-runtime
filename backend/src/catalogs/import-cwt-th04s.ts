import catalogBundle = require('@modbus-manager/device-catalog-domain/examples/cwt-th04s.bundle.json')
import { loadAppConfig } from '../config/app-config'
import { createDatabase } from '../database/database.factory'
import { CatalogRepository } from './catalog.repository'
import { CatalogService } from './catalog.service'
import { CatalogValidationService } from './catalog-validation.service'

const USER_ID_ARGUMENT = '--user-id=' // 최초 등록자로 기록할 기존 users.id 인자. 예: "--user-id=7"

function parseUserId(arguments_: readonly string[]): number {
  const rawValue = arguments_.find((value) => value.startsWith(USER_ID_ARGUMENT))?.slice(USER_ID_ARGUMENT.length)
  const userId = Number(rawValue)
  if (!Number.isSafeInteger(userId) || userId < 1) {
    throw new Error('Usage: npm run catalog:import:cwt-th04s -- --user-id=<existing-user-id>')
  }
  return userId
}

/**
 * 운영자가 Phase 1 최초 구축 시 공유 CWT-TH04S 예제를 DB에 명시적으로 등록할 때 실행한다.
 * 임의 파일을 읽지 않으며 기존 key가 있으면 덮어쓰지 않고 종료해 사용자 수정을 보존한다.
 */
async function importCwtTh04s(): Promise<void> {
  const database = createDatabase(loadAppConfig().database)
  const repository = new CatalogRepository(database)
  try {
    const userId = parseUserId(process.argv.slice(2))
    const user = await database.selectFrom('users').select('id').where('id', '=', userId).executeTakeFirst()
    if (!user) throw new Error('The specified user does not exist')
    if (await repository.findByKey(catalogBundle.profile.id)) {
      console.log(`Catalog already exists: ${catalogBundle.profile.id}`)
      return
    }
    const service = new CatalogService(new CatalogValidationService(), repository)
    const created = await service.create({ title: 'CWT-TH04S 온·습도 센서', definition: catalogBundle }, userId)
    console.log(`Catalog imported: ${created.catalogKey} revision ${created.revision}`)
  } finally {
    await database.destroy()
  }
}

void importCwtTh04s().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown import error'
  console.error(`Catalog import failed: ${message}`)
  process.exitCode = 1
})
