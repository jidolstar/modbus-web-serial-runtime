import { Injectable } from '@nestjs/common'
import { extname } from 'node:path'
import type { CatalogDocumentType } from '../database/database.types'
import { CatalogAiService } from './catalog-ai.service'
import { CatalogAiSessionService } from './catalog-ai-session.service'
import { CatalogAssetRepository } from './catalog-asset.repository'
import { CatalogStorageService } from './catalog-storage.service'
import { CatalogRepository } from './catalog.repository'
import { CatalogService } from './catalog.service'
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'

function documentType(name: string, mime: string): CatalogDocumentType {
  if (mime.startsWith('image/')) return 'reference_image'
  if (extname(name).toLowerCase() === '.pdf') return 'manual'
  return 'other'
}

/** AI 승인에서 검증된 Catalog 생성과 선택 자료의 영구 승격을 하나의 use case로 조정한다. */
@Injectable()
export class CatalogAiApprovalService {
  public constructor(
    private readonly ai: CatalogAiService,
    private readonly sessions: CatalogAiSessionService,
    private readonly catalogs: CatalogService,
    private readonly catalogRepository: CatalogRepository,
    private readonly assets: CatalogAssetRepository,
    private readonly storage: CatalogStorageService,
  ) {}

  /**
   * 검토 모달 승인에서 호출해 완료 proposal을 기존 Catalog 생성 경계로 등록하고 선택 자료만 영구 승격한다.
   * digest·session·자료 소유권이 다르거나 검증 실패 proposal이면 부분 저장을 시작하기 전에 거부한다.
   */
  public async approve(
    sessionId: string,
    input: {
      readonly jobId: string
      readonly proposalDigest: string
      readonly retainedFileIds: readonly string[]
      readonly retainedUrls: readonly string[]
    },
    user: { readonly id: number },
  ): Promise<{
    readonly catalogKey: string
    readonly revision: number
    readonly promotedFileIds: readonly number[]
    readonly createdLinkIds: readonly number[]
  }> {
    const session = this.sessions.require(sessionId, user.id)
    const job = this.ai.getJob(input.jobId, user.id)
    if (job.sessionId !== sessionId || job.status !== 'completed' || !job.proposal || job.proposalDigest !== input.proposalDigest || !job.proposal.validation.valid) {
      throw new CatalogError(CATALOG_ERROR_CODES.aiJobNotReady, 409)
    }
    const retained = new Set(input.retainedFileIds)
    const files = this.sessions.list(session).filter((file) => retained.has(file.id))
    if (files.length !== retained.size) throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, ['retainedFileIds'])
    const sourceByUrl = new Map(job.proposal.sources.map((source) => [source.url, source]))
    if (input.retainedUrls.some((url) => !sourceByUrl.has(url))) throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, ['retainedUrls'])

    const catalog = await this.catalogs.create({ title: job.proposal.title, definition: job.proposal.definition }, user.id)
    const row = await this.assets.findCatalog(catalog.catalogKey)
    if (!row) {
      await this.catalogRepository.deleteByKey(catalog.catalogKey).catch(() => undefined)
      throw new CatalogError(CATALOG_ERROR_CODES.notFound, 404)
    }
    const promoted: Array<{ readonly storageKey: string; readonly file: typeof files[number] }> = []
    const promotedFileIds: number[] = []
    const createdLinkIds: number[] = []
    try {
      for (const file of files) {
        const storageKey = await this.storage.promote(file.absolutePath, 'files', '')
        promoted.push({ storageKey, file })
        const pending = await this.assets.createPendingFile({ catalogId: row.id, title: file.originalName, documentType: documentType(file.originalName, file.contentType), originalName: file.originalName, storageKey, suppliedContentType: file.contentType, byteSize: file.byteSize, sha256: file.sha256, userId: user.id })
        await this.assets.updateFileStatus(pending.id, { status: 'clean', storageKey, contentType: file.contentType, rejectionCode: null })
        promotedFileIds.push(pending.id)
      }
      for (const url of input.retainedUrls) {
        const source = sourceByUrl.get(url)
        if (!source) continue
        createdLinkIds.push((await this.assets.createLink(row.id, source.title, 'reference', source.url, user.id)).id)
      }
      await this.sessions.releaseProviderFiles(session)
      for (const item of promoted) this.sessions.markPromoted(session, item.file.id)
      await this.sessions.removeFiles(session, retained)
      await this.sessions.discard(session.id, user.id)
      return { catalogKey: catalog.catalogKey, revision: catalog.revision, promotedFileIds, createdLinkIds }
    } catch (error) {
      await this.catalogRepository.deleteByKey(catalog.catalogKey).catch(() => undefined)
      for (const item of promoted) await this.storage.restoreToTemporaryPath(item.storageKey, item.file.absolutePath).catch(() => undefined)
      throw error
    }
  }
}
