import { Injectable } from '@nestjs/common'
import type { CatalogBundle } from '@modbus-manager/device-catalog-domain'
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'
import type { CatalogListQuery, CatalogStatusInput, CatalogUpdateInput, CatalogWriteInput } from './catalog-input'
import { CatalogRepository, type CatalogDefinitionValues, type CatalogRow } from './catalog.repository'
import { CatalogValidationService } from './catalog-validation.service'

export interface CatalogSummary {
  readonly catalogKey: string // API와 URL에 쓰는 안정 ID. 예: "cwt-th04s"
  readonly title: string // 사람이 식별하는 제목. 예: "CWT 온습도 센서"
  readonly manufacturer: string // Profile에서 파생한 제조사. 예: "CWT"
  readonly model: string // Profile에서 파생한 모델. 예: "CWT-TH04S"
  readonly schemaVersion: string // Bundle 계약 버전. 예: "1.0"
  readonly revision: number // 낙관적 잠금 번호. 예: 2
  readonly enabled: boolean // 실행 후보 활성 상태. 예: true
  readonly usesExtensions: boolean // TypeScript adapter capability 사용 여부. 예: false
  readonly createdAt: string // ISO 8601 생성 시각. 예: "2026-09-23T00:00:00.000Z"
  readonly updatedAt: string // ISO 8601 수정 시각. 예: "2026-09-23T01:00:00.000Z"
}
export interface CatalogDetail extends CatalogSummary {
  readonly definition: CatalogBundle // 검증되어 DB에 저장된 전체 Bundle
}

function isDuplicateKeyError(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY'
}

/**
 * CatalogController의 use case를 조정하고 검증된 Bundle만 CatalogRepository에 전달한다.
 * CatalogValidationService와 CatalogRepository에 의존하며 DB row를 공개 API 형식으로 변환한다.
 */
@Injectable()
export class CatalogService {
  public constructor(
    private readonly validator: CatalogValidationService,
    private readonly repository: CatalogRepository,
  ) {}

  /** validate endpoint와 create/update가 같은 서버 검증 규칙을 사용하도록 한 진입점이다. */
  public validate(input: CatalogWriteInput): { readonly valid: true; readonly catalogKey: string } {
    const definition = this.validator.validate(input.definition)
    return { valid: true, catalogKey: definition.profile.id }
  }

  /** 등록 endpoint에서 Profile 파생값과 사용자 ID를 함께 저장하고 생성된 상세를 반환한다. */
  public async create(input: CatalogWriteInput, userId: number): Promise<CatalogDetail> {
    const definition = this.validator.validate(input.definition)
    try {
      return this.toDetail(await this.repository.create(this.toDefinitionValues(input.title, definition), userId))
    } catch (error) {
      if (isDuplicateKeyError(error)) throw new CatalogError(CATALOG_ERROR_CODES.duplicateKey, 409)
      throw error
    }
  }

  /** 목록 endpoint에서 definition 원문을 제외한 검색 결과만 반환해 응답 크기를 제한한다. */
  public async list(query: CatalogListQuery): Promise<{ readonly items: CatalogSummary[]; readonly total: number; readonly limit: number; readonly offset: number }> {
    const result = await this.repository.list(query)
    return { items: result.rows.map((row) => this.toSummary(row)), total: result.total, limit: query.limit, offset: query.offset }
  }

  /** 상세 endpoint에서 catalogKey에 해당하는 전체 검증 Bundle을 반환한다. */
  public async get(catalogKey: string): Promise<CatalogDetail> {
    return this.toDetail(await this.requireCatalog(catalogKey))
  }

  /** 전체 수정 endpoint에서 URL key 변경과 오래된 revision 덮어쓰기를 모두 차단한다. */
  public async update(catalogKey: string, input: CatalogUpdateInput, userId: number): Promise<CatalogDetail> {
    const definition = this.validator.validate(input.definition)
    if (definition.profile.id !== catalogKey) {
      throw new CatalogError(CATALOG_ERROR_CODES.invalidInput, 400, ['/definition/profile/id'])
    }
    const updated = await this.repository.update(catalogKey, input.revision, this.toDefinitionValues(input.title, definition), userId)
    if (!updated) await this.throwNotFoundOrRevisionConflict(catalogKey)
    return this.toDetail(await this.requireCatalog(catalogKey))
  }

  /** 상태 변경 endpoint에서 Bundle을 다시 쓰지 않고 enabled와 revision만 변경한다. */
  public async updateStatus(catalogKey: string, input: CatalogStatusInput, userId: number): Promise<CatalogSummary> {
    const updated = await this.repository.updateStatus(catalogKey, input.revision, input.enabled, userId)
    if (!updated) await this.throwNotFoundOrRevisionConflict(catalogKey)
    return this.toSummary(await this.requireCatalog(catalogKey))
  }

  private toDefinitionValues(title: string, definition: CatalogBundle): CatalogDefinitionValues {
    return {
      catalogKey: definition.profile.id,
      title,
      schemaVersion: definition.bundleVersion,
      manufacturer: definition.profile.manufacturer,
      model: definition.profile.model,
      definition,
    }
  }

  private toSummary(row: CatalogRow): CatalogSummary {
    const definition = this.parseStoredDefinition(row.definition_json)
    return {
      catalogKey: row.catalog_key,
      title: row.title,
      manufacturer: row.manufacturer,
      model: row.model,
      schemaVersion: row.schema_version,
      revision: row.revision,
      enabled: Boolean(row.enabled),
      usesExtensions: (definition.profile.extensions?.length ?? 0) > 0,
      createdAt: row.created_at.toISOString(),
      updatedAt: row.updated_at.toISOString(),
    }
  }

  private toDetail(row: CatalogRow): CatalogDetail {
    return { ...this.toSummary(row), definition: this.parseStoredDefinition(row.definition_json) }
  }

  private parseStoredDefinition(value: CatalogBundle | string): CatalogBundle {
    return this.validator.validate(typeof value === 'string' ? JSON.parse(value) : value)
  }

  private async requireCatalog(catalogKey: string): Promise<CatalogRow> {
    const row = await this.repository.findByKey(catalogKey)
    if (!row) throw new CatalogError(CATALOG_ERROR_CODES.notFound, 404)
    return row
  }

  private async throwNotFoundOrRevisionConflict(catalogKey: string): Promise<never> {
    if (!await this.repository.findByKey(catalogKey)) throw new CatalogError(CATALOG_ERROR_CODES.notFound, 404)
    throw new CatalogError(CATALOG_ERROR_CODES.revisionConflict, 409)
  }
}
