import { Inject, Injectable } from '@nestjs/common'
import type { MultipartFile } from '@fastify/multipart'
import type { Readable } from 'node:stream'
import { randomUUID } from 'node:crypto'
import { AppConfig } from '../config/app-config'
import { APP_CONFIG } from '../config/config.module'
import type { CatalogDocumentType } from '../database/database.types'
import { parseCatalogFileFields, type CatalogLinkInput } from './catalog-asset-input'
import { CatalogAssetRepository, type CatalogFileRow, type CatalogLinkRow } from './catalog-asset.repository'
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'
import { FileSafetyScanner } from './catalog-file-safety-scanner'
import { CatalogStorageService } from './catalog-storage.service'

export interface CatalogFileView { readonly id: number; readonly title: string; readonly documentType: CatalogDocumentType; readonly originalName: string; readonly contentType: string; readonly byteSize: number; readonly sha256: string; readonly status: string; readonly createdAt: string }
export interface CatalogLinkView { readonly id: number; readonly title: string; readonly linkType: string; readonly url: string; readonly createdAt: string; readonly updatedAt: string }

/**
 * CatalogAssetController의 use case를 조정하고 DB metadata와 volume 파일의 일관성을 유지한다.
 * CatalogAssetRepository, CatalogStorageService와 FileSafetyScanner에 의존하며 clean 파일만 반환한다.
 */
@Injectable()
export class CatalogAssetService {
  private readonly scanner = new FileSafetyScanner()

  public constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly repository: CatalogAssetRepository,
    private readonly storage: CatalogStorageService,
  ) {}

  /** 썸네일 upload에서 원본을 검증·재인코딩하고 기존 파일은 DB 갱신 성공 뒤 제거한다. */
  public async replaceThumbnail(catalogKey: string, upload: MultipartFile, userId: number): Promise<{ readonly etag: string; readonly byteSize: number; readonly contentType: 'image/jpeg' }> {
    const catalog = await this.requireCatalog(catalogKey)
    const source = await this.storage.writeQuarantine(upload.file, upload.filename, this.config.catalogUploads.thumbnailMaxBytes)
    let convertedPath: string | undefined
    let newStorageKey: string | undefined
    let previousStorageKey: string | undefined
    let previousTrashKey: string | undefined
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(upload.mimetype)) {
      await this.storage.remove(source.temporaryPath)
      throw new CatalogError(CATALOG_ERROR_CODES.fileTypeRejected, 415, ['file'])
    }
    try {
      const converted = await this.storage.createThumbnailJpeg(source.temporaryPath).catch((error: unknown) => {
        // 운영 로그에는 경로나 원본명 없이 decoder 메시지만 남겨 손상 이미지 원인을 진단한다.
        console.warn(`Catalog thumbnail decode rejected: ${error instanceof Error ? error.message : 'unknown decoder error'}`)
        throw new CatalogError(CATALOG_ERROR_CODES.fileTypeRejected, 415, ['file'])
      })
      convertedPath = converted.path
      newStorageKey = await this.storage.promote(converted.path, 'thumbnails', '.jpg')
      const previous = await this.repository.findThumbnail(catalog.id)
      previousStorageKey = previous?.storage_key
      if (previousStorageKey) previousTrashKey = await this.storage.moveToTrash(previousStorageKey)
      await this.repository.upsertThumbnail(catalog.id, newStorageKey, converted.byteSize, converted.etag, userId)
    } catch (error) {
      if (newStorageKey) await this.storage.remove(newStorageKey)
      if (previousTrashKey && previousStorageKey) await this.storage.restoreFromTrash(previousTrashKey, previousStorageKey)
      throw error
    } finally {
      await this.storage.remove(source.temporaryPath)
      if (convertedPath) await this.storage.remove(convertedPath)
    }
    // DB가 새 key를 가리킨 뒤의 trash 정리는 실패해도 새 썸네일 가용성을 깨지 않는다.
    if (previousTrashKey) await this.storage.remove(previousTrashKey).catch(() => undefined)
    const thumbnail = await this.repository.findThumbnail(catalog.id)
    if (!thumbnail) throw new CatalogError(CATALOG_ERROR_CODES.assetNotFound, 404)
    return { etag: thumbnail.etag, byteSize: thumbnail.byte_size, contentType: 'image/jpeg' }
  }

  /** 인증된 thumbnail 조회에서 cache metadata와 JPEG stream을 함께 반환한다. */
  public async getThumbnail(catalogKey: string): Promise<{ readonly stream: Readable; readonly etag: string; readonly byteSize: number }> {
    const catalog = await this.requireCatalog(catalogKey)
    const thumbnail = await this.repository.findThumbnail(catalog.id)
    if (!thumbnail) throw new CatalogError(CATALOG_ERROR_CODES.assetNotFound, 404)
    return { stream: this.storage.openReadStream(thumbnail.storage_key), etag: thumbnail.etag, byteSize: thumbnail.byte_size }
  }

  /** 참고 파일 upload를 stream 저장한 뒤 확장자·MIME·내용 검사를 모두 통과한 경우에만 clean으로 등록한다. */
  public async uploadFile(catalogKey: string, upload: MultipartFile, userId: number): Promise<CatalogFileView> {
    const catalog = await this.requireCatalog(catalogKey)
    const staged = await this.storage.writeQuarantine(upload.file, upload.filename, this.config.catalogUploads.fileMaxBytes)
    const multipartFields = Object.fromEntries(Object.entries(upload.fields).flatMap(([key, field]) => {
      const value = Array.isArray(field) ? field[0] : field
      return value && value.type === 'field' && typeof value.value === 'string' ? [[key, value.value]] : []
    }))
    let fields: { readonly title: string; readonly documentType: CatalogDocumentType }
    try {
      fields = parseCatalogFileFields(multipartFields)
    } catch (error) {
      await this.storage.remove(staged.temporaryPath)
      throw error
    }
    const pending = await this.repository.createPendingFile({ catalogId: catalog.id, ...fields, originalName: staged.originalName, storageKey: staged.temporaryKey, suppliedContentType: upload.mimetype, byteSize: staged.byteSize, sha256: staged.sha256, userId }).catch(async (error: unknown) => {
      await this.storage.remove(staged.temporaryPath)
      throw error
    })
    let storageKey: string | undefined
    try {
      const contentType = await this.scanner.inspect(staged.temporaryPath, staged.originalName, upload.mimetype)
      storageKey = await this.storage.promote(staged.temporaryPath, 'files', '')
      await this.repository.updateFileStatus(pending.id, { status: 'clean', storageKey, contentType, rejectionCode: null })
      return this.toFileView((await this.repository.findFile(catalog.id, pending.id)) as CatalogFileRow)
    } catch (error) {
      if (storageKey) await this.storage.remove(storageKey)
      await this.storage.remove(staged.temporaryPath)
      const rejected = error instanceof CatalogError && error.getStatus() === 415
      await this.repository.updateFileStatus(pending.id, {
        status: rejected ? 'rejected' : 'failed',
        storageKey: `${rejected ? 'rejected' : 'failed'}/${randomUUID()}`,
        contentType: upload.mimetype,
        rejectionCode: rejected ? CATALOG_ERROR_CODES.fileTypeRejected : 'FILE_PROCESSING_FAILED',
      }).catch(() => undefined)
      throw error
    } finally {
      await this.storage.remove(staged.temporaryPath)
    }
  }

  public async listFiles(catalogKey: string): Promise<CatalogFileView[]> {
    const catalog = await this.requireCatalog(catalogKey)
    return (await this.repository.listFiles(catalog.id)).map((row) => this.toFileView(row))
  }

  /** clean 상태 파일에만 인증 download를 허용하고 storage 내부 경로는 공개하지 않는다. */
  public async downloadFile(catalogKey: string, fileId: number): Promise<{ readonly stream: Readable; readonly file: CatalogFileView }> {
    const catalog = await this.requireCatalog(catalogKey)
    const row = await this.repository.findFile(catalog.id, fileId)
    if (!row) throw new CatalogError(CATALOG_ERROR_CODES.assetNotFound, 404)
    if (row.status !== 'clean') throw new CatalogError(CATALOG_ERROR_CODES.fileNotClean, 409)
    return { stream: this.storage.openReadStream(row.storage_key), file: this.toFileView(row) }
  }

  /** 삭제 시 파일을 먼저 trash로 옮기고 DB 실패 시 원위치해 orphan 또는 깨진 metadata를 막는다. */
  public async deleteFile(catalogKey: string, fileId: number): Promise<void> {
    const catalog = await this.requireCatalog(catalogKey)
    const row = await this.repository.findFile(catalog.id, fileId)
    if (!row) throw new CatalogError(CATALOG_ERROR_CODES.assetNotFound, 404)
    const trashKey = await this.storage.moveToTrash(row.storage_key)
    try {
      if (!await this.repository.deleteFile(catalog.id, fileId)) throw new CatalogError(CATALOG_ERROR_CODES.assetNotFound, 404)
      if (trashKey) await this.storage.remove(trashKey)
    } catch (error) {
      if (trashKey) await this.storage.restoreFromTrash(trashKey, row.storage_key)
      throw error
    }
  }

  public async listLinks(catalogKey: string): Promise<CatalogLinkView[]> {
    const catalog = await this.requireCatalog(catalogKey)
    return (await this.repository.listLinks(catalog.id)).map((row) => this.toLinkView(row))
  }

  public async createLink(catalogKey: string, input: CatalogLinkInput, userId: number): Promise<CatalogLinkView> {
    const catalog = await this.requireCatalog(catalogKey)
    return this.toLinkView(await this.repository.createLink(catalog.id, input.title, input.linkType, input.url, userId))
  }

  public async updateLink(catalogKey: string, linkId: number, input: CatalogLinkInput, userId: number): Promise<CatalogLinkView> {
    const catalog = await this.requireCatalog(catalogKey)
    const row = await this.repository.updateLink(catalog.id, linkId, input.title, input.linkType, input.url, userId)
    if (!row) throw new CatalogError(CATALOG_ERROR_CODES.assetNotFound, 404)
    return this.toLinkView(row)
  }

  public async deleteLink(catalogKey: string, linkId: number): Promise<void> {
    const catalog = await this.requireCatalog(catalogKey)
    if (!await this.repository.deleteLink(catalog.id, linkId)) throw new CatalogError(CATALOG_ERROR_CODES.assetNotFound, 404)
  }

  private async requireCatalog(catalogKey: string) {
    const row = await this.repository.findCatalog(catalogKey)
    if (!row) throw new CatalogError(CATALOG_ERROR_CODES.notFound, 404)
    return row
  }

  private toFileView(row: CatalogFileRow): CatalogFileView {
    return { id: row.id, title: row.title, documentType: row.document_type, originalName: row.original_name, contentType: row.content_type, byteSize: row.byte_size, sha256: row.sha256, status: row.status, createdAt: row.created_at.toISOString() }
  }

  private toLinkView(row: CatalogLinkRow): CatalogLinkView {
    return { id: row.id, title: row.title, linkType: row.link_type, url: row.url, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() }
  }
}
