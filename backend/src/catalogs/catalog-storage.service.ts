import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve, sep } from 'node:path'
import { Inject, Injectable } from '@nestjs/common'
import type sharpFactory from 'sharp'
import type { Readable } from 'node:stream'
import { AppConfig } from '../config/app-config'
import { APP_CONFIG } from '../config/config.module'
import { CATALOG_ERROR_CODES, CATALOG_ORIGINAL_NAME_MAX_LENGTH } from './catalog.constants'
import { CatalogError } from './catalog.error'

// sharp의 CommonJS runtime export와 default-export type 차이를 명시적으로 맞춘다.
const sharp: typeof sharpFactory = require('sharp')

export interface StoredUpload {
  readonly temporaryPath: string // quarantine 절대 경로. API 응답이나 DB에는 노출하지 않는다.
  readonly temporaryKey: string // pending metadata가 참조할 volume 내부 key. 예: "quarantine/uuid.upload"
  readonly byteSize: number // 실제 stream에서 계산한 byte 수
  readonly sha256: string // stream bytes SHA-256 hex
  readonly originalName: string // 경로·제어문자를 제거한 안전한 표시 파일명
}

/**
 * CatalogAssetService가 Backend 전용 volume의 quarantine·최종·trash 이동을 요청한다.
 * 모든 storage key는 서버가 생성하며 사용자 파일명을 경로로 사용하지 않는다.
 */
@Injectable()
export class CatalogStorageService {
  private readonly rootPath: string

  public constructor(@Inject(APP_CONFIG) config: AppConfig) {
    if (!isAbsolute(config.catalogUploads.rootPath)) throw new Error('CATALOG_UPLOAD_ROOT must be an absolute path')
    this.rootPath = resolve(config.catalogUploads.rootPath)
  }

  /** multipart stream을 크기 제한하며 quarantine에 기록하고 실제 hash·크기를 계산한다. */
  public async writeQuarantine(stream: Readable, originalName: string, maxBytes: number): Promise<StoredUpload> {
    const directory = this.pathFor('quarantine')
    await mkdir(directory, { recursive: true })
    const temporaryKey = `quarantine/${randomUUID()}.upload`
    const temporaryPath = this.pathFor(temporaryKey)
    const handle = await open(temporaryPath, 'wx')
    const hash = createHash('sha256')
    let byteSize = 0
    try {
      for await (const chunk of stream) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        byteSize += buffer.length
        if (byteSize > maxBytes) throw new CatalogError(CATALOG_ERROR_CODES.fileTooLarge, 413, ['file'])
        hash.update(buffer)
        await handle.write(buffer)
      }
      if (byteSize === 0) throw new CatalogError(CATALOG_ERROR_CODES.assetInvalidInput, 400, ['file'])
      return { temporaryPath, temporaryKey, byteSize, sha256: hash.digest('hex'), originalName: this.safeOriginalName(originalName) }
    } catch (error) {
      await handle.close()
      await rm(temporaryPath, { force: true })
      throw error
    } finally {
      await handle.close().catch(() => undefined)
    }
  }

  /** 검사를 통과한 quarantine 파일을 서버 생성 key로 원자 이동한다. */
  public async promote(temporaryPath: string, category: 'files' | 'thumbnails', extension: string): Promise<string> {
    const storageKey = `${category}/${randomUUID()}${extension}`
    const destination = this.pathFor(storageKey)
    await mkdir(resolve(destination, '..'), { recursive: true })
    await rename(temporaryPath, destination)
    return storageKey
  }

  /** 썸네일 원본을 방향 보정·중앙 crop 후 metadata 없는 300×300 JPEG로 만든다. */
  public async createThumbnailJpeg(sourcePath: string): Promise<{ readonly path: string; readonly byteSize: number; readonly etag: string }> {
    const metadata = await sharp(sourcePath, { limitInputPixels: 40_000_000 }).metadata()
    if (!['jpeg', 'png', 'webp'].includes(metadata.format ?? '') || !metadata.width || !metadata.height) {
      throw new CatalogError(CATALOG_ERROR_CODES.fileTypeRejected, 415, ['file'])
    }
    const outputPath = join(this.pathFor('quarantine'), `${randomUUID()}.jpg`)
    await sharp(sourcePath, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize(300, 300, { fit: 'cover', position: 'centre' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(outputPath)
    const bytes = await readFile(outputPath)
    return { path: outputPath, byteSize: bytes.length, etag: createHash('sha256').update(bytes).digest('hex') }
  }

  /** 인증된 download endpoint만 최종 파일 stream을 열 때 사용한다. */
  public openReadStream(storageKey: string) {
    return createReadStream(this.pathFor(storageKey))
  }

  /** 교체·삭제 전 파일을 trash로 옮겨 DB 실패 시 복원할 수 있게 한다. */
  public async moveToTrash(storageKey: string): Promise<string | undefined> {
    const source = this.pathFor(storageKey)
    try { await stat(source) } catch { return undefined }
    const trashKey = `trash/${randomUUID()}`
    const target = this.pathFor(trashKey)
    await mkdir(resolve(target, '..'), { recursive: true })
    await rename(source, target)
    return trashKey
  }

  public async restoreFromTrash(trashKey: string, storageKey: string): Promise<void> {
    await rename(this.pathFor(trashKey), this.pathFor(storageKey))
  }

  public async remove(storageKeyOrPath: string): Promise<void> {
    const target = isAbsolute(storageKeyOrPath) ? resolve(storageKeyOrPath) : this.pathFor(storageKeyOrPath)
    this.assertInsideRoot(target)
    await rm(target, { force: true })
  }

  private pathFor(storageKey: string): string {
    const target = resolve(this.rootPath, storageKey)
    this.assertInsideRoot(target)
    return target
  }

  private assertInsideRoot(target: string): void {
    if (target !== this.rootPath && !target.startsWith(`${this.rootPath}${sep}`)) throw new Error('Storage path escaped upload root')
  }

  private safeOriginalName(value: string): string {
    const cleaned = basename(value).replace(/[\u0000-\u001f\u007f]/g, '').trim()
    if (!cleaned || cleaned.length > CATALOG_ORIGINAL_NAME_MAX_LENGTH) throw new CatalogError(CATALOG_ERROR_CODES.assetInvalidInput, 400, ['fileName'])
    return cleaned
  }
}
