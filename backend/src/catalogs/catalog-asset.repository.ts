import { Inject, Injectable } from '@nestjs/common'
import { Kysely, Selectable } from 'kysely'
import { DATABASE } from '../database/database.module'
import type { CatalogDocumentType, CatalogFilesTable, CatalogLinksTable, CatalogLinkType, CatalogsTable, CatalogThumbnailsTable, DatabaseSchema } from '../database/database.types'

export type CatalogFileRow = Selectable<CatalogFilesTable>
export type CatalogLinkRow = Selectable<CatalogLinksTable>
export type CatalogThumbnailRow = Selectable<CatalogThumbnailsTable>

/**
 * CatalogAssetService의 파일·썸네일·링크 metadata 요청을 parameter query로 처리한다.
 * storage bytes는 다루지 않으며 모든 asset 조회에서 catalog_id 소속을 함께 제한한다.
 */
@Injectable()
export class CatalogAssetRepository {
  public constructor(@Inject(DATABASE) private readonly database: Kysely<DatabaseSchema>) {}

  public findCatalog(catalogKey: string): Promise<Selectable<CatalogsTable> | undefined> {
    return this.database.selectFrom('catalog').selectAll().where('catalog_key', '=', catalogKey).executeTakeFirst()
  }

  public findThumbnail(catalogId: number): Promise<CatalogThumbnailRow | undefined> {
    return this.database.selectFrom('catalog_thumbnails').selectAll().where('catalog_id', '=', catalogId).executeTakeFirst()
  }

  /** 썸네일 교체 시 Catalog당 한 row 제약을 이용해 metadata를 원자 upsert한다. */
  public async upsertThumbnail(catalogId: number, storageKey: string, byteSize: number, etag: string, userId: number): Promise<void> {
    await this.database.insertInto('catalog_thumbnails').values({
      catalog_id: catalogId, storage_key: storageKey, content_type: 'image/jpeg', byte_size: byteSize, etag, updated_by_user_id: userId,
    }).onDuplicateKeyUpdate({ storage_key: storageKey, byte_size: byteSize, etag, updated_by_user_id: userId }).execute()
  }

  public listFiles(catalogId: number): Promise<CatalogFileRow[]> {
    return this.database.selectFrom('catalog_files').selectAll().where('catalog_id', '=', catalogId).orderBy('created_at', 'desc').execute()
  }

  public findFile(catalogId: number, fileId: number): Promise<CatalogFileRow | undefined> {
    return this.database.selectFrom('catalog_files').selectAll().where('catalog_id', '=', catalogId).where('id', '=', fileId).executeTakeFirst()
  }

  /** quarantine 저장 직후 pending metadata를 만들어 검증 중 파일이 다운로드되지 않게 한다. */
  public async createPendingFile(values: { catalogId: number; title: string; documentType: CatalogDocumentType; originalName: string; storageKey: string; suppliedContentType: string; byteSize: number; sha256: string; userId: number }): Promise<CatalogFileRow> {
    const result = await this.database.insertInto('catalog_files').values({
      catalog_id: values.catalogId, title: values.title, document_type: values.documentType, original_name: values.originalName,
      storage_key: values.storageKey, content_type: values.suppliedContentType, byte_size: values.byteSize, sha256: values.sha256,
      status: 'pending', rejection_code: null, created_by_user_id: values.userId,
    }).executeTakeFirstOrThrow()
    return this.findFile(values.catalogId, Number(result.insertId)) as Promise<CatalogFileRow>
  }

  /** scanner 결과를 pending row에 반영하며 clean일 때만 최종 storage key와 canonical MIME을 기록한다. */
  public async updateFileStatus(fileId: number, values: { status: 'clean' | 'rejected' | 'failed'; storageKey: string; contentType: string; rejectionCode: string | null }): Promise<void> {
    await this.database.updateTable('catalog_files').set({ status: values.status, storage_key: values.storageKey, content_type: values.contentType, rejection_code: values.rejectionCode }).where('id', '=', fileId).executeTakeFirstOrThrow()
  }

  public async deleteFile(catalogId: number, fileId: number): Promise<boolean> {
    const result = await this.database.deleteFrom('catalog_files').where('catalog_id', '=', catalogId).where('id', '=', fileId).executeTakeFirst()
    return result.numDeletedRows === 1n
  }

  public listLinks(catalogId: number): Promise<CatalogLinkRow[]> {
    return this.database.selectFrom('catalog_links').selectAll().where('catalog_id', '=', catalogId).orderBy('created_at', 'desc').execute()
  }

  public findLink(catalogId: number, linkId: number): Promise<CatalogLinkRow | undefined> {
    return this.database.selectFrom('catalog_links').selectAll().where('catalog_id', '=', catalogId).where('id', '=', linkId).executeTakeFirst()
  }

  public async createLink(catalogId: number, title: string, linkType: CatalogLinkType, url: string, userId: number): Promise<CatalogLinkRow> {
    const result = await this.database.insertInto('catalog_links').values({ catalog_id: catalogId, title, link_type: linkType, url, created_by_user_id: userId, updated_by_user_id: userId }).executeTakeFirstOrThrow()
    return this.findLink(catalogId, Number(result.insertId)) as Promise<CatalogLinkRow>
  }

  public async updateLink(catalogId: number, linkId: number, title: string, linkType: CatalogLinkType, url: string, userId: number): Promise<CatalogLinkRow | undefined> {
    const result = await this.database.updateTable('catalog_links').set({ title, link_type: linkType, url, updated_by_user_id: userId }).where('catalog_id', '=', catalogId).where('id', '=', linkId).executeTakeFirst()
    return result.numUpdatedRows === 1n ? this.findLink(catalogId, linkId) : undefined
  }

  public async deleteLink(catalogId: number, linkId: number): Promise<boolean> {
    const result = await this.database.deleteFrom('catalog_links').where('catalog_id', '=', catalogId).where('id', '=', linkId).executeTakeFirst()
    return result.numDeletedRows === 1n
  }
}
