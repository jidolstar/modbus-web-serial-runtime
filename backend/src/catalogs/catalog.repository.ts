import { Inject, Injectable } from '@nestjs/common'
import type { CatalogBundle } from '@modbus-manager/device-catalog-domain'
import { Kysely, Selectable } from 'kysely'
import { DATABASE } from '../database/database.module'
import { CatalogsTable, DatabaseSchema } from '../database/database.types'
import type { CatalogListQuery } from './catalog-input'

export type CatalogRow = Selectable<CatalogsTable>

export interface CatalogDefinitionValues {
  readonly catalogKey: string // Profile에서 추출한 DB unique key. 예: "cwt-th04s"
  readonly title: string // 사용자가 입력한 표시 제목. 예: "CWT 온습도 센서"
  readonly schemaVersion: string // Bundle 버전. 예: "1.0"
  readonly manufacturer: string // Profile 제조사. 예: "CWT"
  readonly model: string // Profile 모델. 예: "CWT-TH04S"
  readonly definition: CatalogBundle // 검증 완료된 전체 Bundle
}

/**
 * CatalogService의 영속화 요청을 Kysely parameter query로 실행한다.
 * DatabaseModule의 공유 connection에 의존하며 controller에는 DB row를 직접 노출하지 않는다.
 */
@Injectable()
export class CatalogRepository {
  public constructor(@Inject(DATABASE) private readonly database: Kysely<DatabaseSchema>) {}

  /** 등록 API에서 검증 완료된 Bundle과 사용자 ID를 하나의 row로 저장한다. */
  public async create(values: CatalogDefinitionValues, userId: number): Promise<CatalogRow> {
    const result = await this.database.insertInto('catalog').values({
      catalog_key: values.catalogKey,
      title: values.title,
      schema_version: values.schemaVersion,
      manufacturer: values.manufacturer,
      model: values.model,
      // mysql2가 임의 객체를 SQL parameter로 해석하지 않도록 검증된 Bundle만 JSON 문자열로 직렬화한다.
      definition_json: JSON.stringify(values.definition),
      created_by_user_id: userId,
      updated_by_user_id: userId,
    }).executeTakeFirstOrThrow()
    return this.findById(Number(result.insertId)) as Promise<CatalogRow>
  }

  /** 목록 API에서 검색·상태 조건을 적용하고 전체 개수와 현재 page를 함께 반환한다. */
  public async list(query: CatalogListQuery): Promise<{ readonly rows: CatalogRow[]; readonly total: number }> {
    let rowsQuery = this.database.selectFrom('catalog').selectAll()
    let countQuery = this.database.selectFrom('catalog').select(({ fn }) => fn.countAll().as('total'))
    if (query.enabled !== undefined) {
      rowsQuery = rowsQuery.where('enabled', '=', query.enabled)
      countQuery = countQuery.where('enabled', '=', query.enabled)
    }
    if (query.q) {
      const pattern = `%${query.q.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`
      rowsQuery = rowsQuery.where((expression) => expression.or([
        expression('title', 'like', pattern),
        expression('catalog_key', 'like', pattern),
        expression('manufacturer', 'like', pattern),
        expression('model', 'like', pattern),
      ]))
      countQuery = countQuery.where((expression) => expression.or([
        expression('title', 'like', pattern),
        expression('catalog_key', 'like', pattern),
        expression('manufacturer', 'like', pattern),
        expression('model', 'like', pattern),
      ]))
    }
    const [rows, count] = await Promise.all([
      rowsQuery.orderBy('updated_at', 'desc').limit(query.limit).offset(query.offset).execute(),
      countQuery.executeTakeFirstOrThrow(),
    ])
    return { rows, total: Number(count.total) }
  }

  /** 상세·수정 API가 안정 key로 현재 row를 조회할 때 사용한다. */
  public findByKey(catalogKey: string): Promise<CatalogRow | undefined> {
    return this.database.selectFrom('catalog').selectAll().where('catalog_key', '=', catalogKey).executeTakeFirst()
  }

  private findById(id: number): Promise<CatalogRow | undefined> {
    return this.database.selectFrom('catalog').selectAll().where('id', '=', id).executeTakeFirst()
  }

  /** 수정 API에서 key와 revision이 모두 일치할 때만 전체 정의를 교체한다. */
  public async update(catalogKey: string, revision: number, values: CatalogDefinitionValues, userId: number): Promise<boolean> {
    const result = await this.database.updateTable('catalog').set({
      catalog_key: values.catalogKey,
      title: values.title,
      schema_version: values.schemaVersion,
      manufacturer: values.manufacturer,
      model: values.model,
      definition_json: JSON.stringify(values.definition),
      revision: revision + 1,
      updated_by_user_id: userId,
    }).where('catalog_key', '=', catalogKey).where('revision', '=', revision).executeTakeFirst()
    return result.numUpdatedRows === 1n
  }

  /** 상태 API에서 definition을 건드리지 않고 enabled와 revision만 원자적으로 변경한다. */
  public async updateStatus(catalogKey: string, revision: number, enabled: boolean, userId: number): Promise<boolean> {
    const result = await this.database.updateTable('catalog').set({
      enabled,
      revision: revision + 1,
      updated_by_user_id: userId,
    }).where('catalog_key', '=', catalogKey).where('revision', '=', revision).executeTakeFirst()
    return result.numUpdatedRows === 1n
  }
}
