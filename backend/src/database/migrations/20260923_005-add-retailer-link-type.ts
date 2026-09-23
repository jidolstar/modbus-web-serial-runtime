import { Kysely, sql } from 'kysely'
import { Migration } from 'kysely/migration'
import type { DatabaseSchema } from '../database.types'

/**
 * Catalog 참고 링크에 온라인 쇼핑몰과 오프라인 판매점을 함께 나타내는 `retailer` 유형을 추가한다.
 * 애플리케이션 enum과 DB 제약을 같은 배포에서 변경해 검증을 통과한 값이 저장 단계에서 거절되지 않게 한다.
 */
export const addRetailerLinkTypeMigration: Migration = {
  async up(database: Kysely<DatabaseSchema>): Promise<void> {
    await sql`ALTER TABLE catalog_links MODIFY COLUMN link_type ENUM('official_website','manufacturer_page','documentation','reference','retailer') NOT NULL`.execute(database)
  },

  async down(database: Kysely<DatabaseSchema>): Promise<void> {
    // 이전 schema로 복구할 때 retailer 링크를 삭제하지 않고 가장 가까운 일반 참고 자료로 보존한다.
    await sql`UPDATE catalog_links SET link_type = 'reference' WHERE link_type = 'retailer'`.execute(database)
    await sql`ALTER TABLE catalog_links MODIFY COLUMN link_type ENUM('official_website','manufacturer_page','documentation','reference') NOT NULL`.execute(database)
  },
}
