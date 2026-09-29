import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readdir, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, resolve, sep } from 'node:path'
import type { Readable } from 'node:stream'
import { APP_CONFIG } from '../config/config.module'
import { AppConfig } from '../config/app-config'
import { CATALOG_ERROR_CODES, CATALOG_ORIGINAL_NAME_MAX_LENGTH } from './catalog.constants'
import { CatalogError } from './catalog.error'
import { FileSafetyScanner } from './catalog-file-safety-scanner'
import { AI_MAX_FILES, AI_MAX_TOTAL_FILE_BYTES } from './catalog-ai-input'
import type { CatalogAiSessionFile } from './catalog-ai.types'
import { GeminiFileService } from './gemini-file.service'

interface CatalogAiSession {
  readonly id: string
  readonly ownerUserId: number
  readonly createdAt: number
  lastActiveAt: number
  readonly files: Map<string, CatalogAiSessionFile>
}

const IDLE_TTL_MS = 60 * 60 * 1_000
const ABSOLUTE_TTL_MS = 6 * 60 * 60 * 1_000
const CLEANUP_INTERVAL_MS = 10 * 60 * 1_000

/** AI 등록 중인 파일을 Backend 전용 임시 directory에 두고 소유권과 TTL을 관리한다. */
@Injectable()
export class CatalogAiSessionService implements OnModuleInit, OnModuleDestroy {
  private readonly sessions = new Map<string, CatalogAiSession>()
  private readonly rootPath: string
  private readonly scanner = new FileSafetyScanner()
  private cleanupTimer?: NodeJS.Timeout

  public constructor(@Inject(APP_CONFIG) config: AppConfig, private readonly geminiFiles: GeminiFileService) {
    if (!isAbsolute(config.catalogUploads.rootPath)) throw new Error('CATALOG_UPLOAD_ROOT must be absolute')
    this.rootPath = resolve(config.catalogUploads.rootPath, 'ai-sessions')
  }

  public async onModuleInit(): Promise<void> {
    await mkdir(this.rootPath, { recursive: true })
    await this.removeStaleDirectories()
    this.cleanupTimer = setInterval(() => { void this.cleanupExpired() }, CLEANUP_INTERVAL_MS)
    this.cleanupTimer.unref()
  }

  /** Nest 종료 때 cleanup timer가 process 생명주기를 붙잡지 않도록 해제한다. 저장 파일은 다음 시작 cleanup이 처리한다. */
  public onModuleDestroy(): void {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer)
  }

  /** 최초 AI job이 호출해 인증 사용자에게 귀속된 메모리 session을 만든다. 파일 directory는 첫 upload 때 생성한다. */
  public create(ownerUserId: number): CatalogAiSession {
    const id = randomUUID()
    const now = Date.now()
    const session: CatalogAiSession = { id, ownerUserId, createdAt: now, lastActiveAt: now, files: new Map() }
    this.sessions.set(id, session)
    return session
  }

  /** 모든 job·승인·취소 경계가 호출하며, 다른 사용자의 ID와 만료 session을 같은 404로 숨긴다. */
  public require(sessionId: string, ownerUserId: number): CatalogAiSession {
    const session = this.sessions.get(sessionId)
    if (!session || session.ownerUserId !== ownerUserId) throw new CatalogError(CATALOG_ERROR_CODES.aiJobNotFound, 404)
    if (this.expired(session, Date.now())) {
      void this.discard(session.id, ownerUserId)
      throw new CatalogError(CATALOG_ERROR_CODES.aiJobNotFound, 404)
    }
    session.lastActiveAt = Date.now()
    return session
  }

  /** multipart 생성 endpoint가 호출하며 크기·실제 파일 형식을 검사한 뒤 Backend 전용 임시 경로에 저장한다. */
  public async addFile(session: CatalogAiSession, stream: Readable, originalName: string, suppliedMime: string, maxBytes: number): Promise<CatalogAiSessionFile> {
    if (session.files.size >= AI_MAX_FILES) throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, ['files'])
    const safeName = basename(originalName).replace(/[\u0000-\u001f\u007f]/g, '').trim()
    if (!safeName || safeName.length > CATALOG_ORIGINAL_NAME_MAX_LENGTH) throw new CatalogError(CATALOG_ERROR_CODES.aiInvalidInput, 400, ['files'])
    const id = randomUUID()
    const directory = this.sessionPath(session.id)
    await mkdir(directory, { recursive: true })
    const absolutePath = resolve(directory, `${id}.upload`)
    this.assertInsideRoot(absolutePath)
    const handle = await open(absolutePath, 'wx')
    const hash = createHash('sha256')
    let byteSize = 0
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        byteSize += buffer.length
        if (byteSize > maxBytes) throw new CatalogError(CATALOG_ERROR_CODES.fileTooLarge, 413, ['files'])
        hash.update(buffer)
        await handle.write(buffer)
      }
    } catch (error) {
      await handle.close().catch(() => undefined)
      await rm(absolutePath, { force: true })
      throw error
    } finally {
      await handle.close().catch(() => undefined)
    }
    const total = [...session.files.values()].reduce((sum, file) => sum + file.byteSize, 0) + byteSize
    if (!byteSize || total > AI_MAX_TOTAL_FILE_BYTES) {
      await rm(absolutePath, { force: true })
      throw new CatalogError(CATALOG_ERROR_CODES.fileTooLarge, 413, ['files'])
    }
    const contentType = await this.scanner.inspect(absolutePath, safeName, suppliedMime).catch(async (error) => {
      await rm(absolutePath, { force: true })
      throw error
    })
    const sha256 = hash.digest('hex')
    const duplicate = [...session.files.values()].find((file) => file.sha256 === sha256 && file.byteSize === byteSize && file.contentType === contentType)
    if (duplicate) {
      await rm(absolutePath, { force: true })
      session.lastActiveAt = Date.now()
      return duplicate
    }
    const file: CatalogAiSessionFile = { id, originalName: safeName, contentType, byteSize, sha256, absolutePath }
    session.files.set(id, file)
    session.lastActiveAt = Date.now()
    return file
  }

  public list(session: CatalogAiSession): readonly CatalogAiSessionFile[] { return [...session.files.values()] }
  public open(file: CatalogAiSessionFile) { return createReadStream(file.absolutePath) }

  /** 승인 service가 선택하지 않은 자료를 local·Gemini 양쪽에서 제거한다. */
  public async removeFiles(session: CatalogAiSession, retainedIds: ReadonlySet<string>): Promise<void> {
    for (const [id, file] of session.files) if (!retainedIds.has(id)) {
      await this.geminiFiles.delete(file)
      await rm(file.absolutePath, { force: true }); session.files.delete(id)
    }
  }
  public markPromoted(session: CatalogAiSession, fileId: string): void { session.files.delete(fileId) }

  /** 승인 직전에 호출해 영구 Catalog asset과 무관한 Gemini provider 사본을 정리한다. */
  public async releaseProviderFiles(session: CatalogAiSession): Promise<void> {
    await Promise.all([...session.files.values()].map((file) => this.geminiFiles.delete(file)))
  }

  /** session 폐기와 TTL cleanup이 호출하며 provider 삭제 실패와 관계없이 local directory를 제거한다. */
  public async discard(sessionId: string, ownerUserId: number): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session || session.ownerUserId !== ownerUserId) return
    this.sessions.delete(sessionId)
    await Promise.all([...session.files.values()].map((file) => this.geminiFiles.delete(file)))
    await rm(this.sessionPath(sessionId), { recursive: true, force: true })
  }

  /** 사용자 취소 API에서 소유권을 확인한 뒤 임시 local·Gemini 파일만 폐기한다. 감사 DB 기록은 이 서비스의 책임이 아니다. */
  public async discardOwned(sessionId: string, ownerUserId: number): Promise<void> {
    this.require(sessionId, ownerUserId)
    await this.discard(sessionId, ownerUserId)
  }

  private async cleanupExpired(): Promise<void> {
    const now = Date.now()
    for (const session of this.sessions.values()) if (this.expired(session, now)) await this.discard(session.id, session.ownerUserId).catch(() => undefined)
    await this.removeStaleDirectories()
  }
  private expired(session: CatalogAiSession, now: number): boolean { return now - session.lastActiveAt > IDLE_TTL_MS || now - session.createdAt > ABSOLUTE_TTL_MS }
  private sessionPath(sessionId: string): string {
    const path = resolve(this.rootPath, sessionId)
    this.assertInsideRoot(path)
    return path
  }
  private assertInsideRoot(path: string): void { if (path !== this.rootPath && !path.startsWith(`${this.rootPath}${sep}`)) throw new Error('AI session path escaped upload root') }
  private async removeStaleDirectories(): Promise<void> {
    const entries = await readdir(this.rootPath, { withFileTypes: true }).catch(() => [])
    const cutoff = Date.now() - ABSOLUTE_TTL_MS
    for (const entry of entries) if (entry.isDirectory() && !this.sessions.has(entry.name)) {
      const path = this.sessionPath(entry.name)
      const info = await stat(path).catch(() => undefined)
      if (info && info.mtimeMs < cutoff) await rm(path, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
