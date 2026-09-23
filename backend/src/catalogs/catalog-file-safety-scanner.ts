import { open } from 'node:fs/promises'
import { extname } from 'node:path'
import { TextDecoder } from 'node:util'
import yauzl from 'yauzl'
import { CATALOG_ERROR_CODES } from './catalog.constants'
import { CatalogError } from './catalog.error'

interface AllowedFileType {
  readonly contentType: string // 저장·다운로드에 사용할 canonical MIME. 예: "application/pdf"
  readonly mimeAliases: readonly string[] // browser가 보낼 수 있는 허용 MIME 목록
}

const ALLOWED_FILE_TYPES: Readonly<Record<string, AllowedFileType>> = Object.freeze({
  '.pdf': { contentType: 'application/pdf', mimeAliases: ['application/pdf'] },
  '.txt': { contentType: 'text/plain', mimeAliases: ['text/plain'] },
  '.png': { contentType: 'image/png', mimeAliases: ['image/png'] },
  '.jpg': { contentType: 'image/jpeg', mimeAliases: ['image/jpeg'] },
  '.jpeg': { contentType: 'image/jpeg', mimeAliases: ['image/jpeg'] },
  '.webp': { contentType: 'image/webp', mimeAliases: ['image/webp'] },
  '.doc': { contentType: 'application/msword', mimeAliases: ['application/msword', 'application/octet-stream'] },
  '.docx': { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', mimeAliases: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/zip'] },
})

const OLE_MAGIC = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const ZIP_ENTRY_MAX_COUNT = 2_000
const ZIP_UNCOMPRESSED_MAX_BYTES = 100 * 1024 * 1024
const ZIP_RATIO_MAX = 100

function startsWith(buffer: Buffer, magic: Buffer): boolean {
  return buffer.subarray(0, magic.length).equals(magic)
}

function reject(): never {
  throw new CatalogError(CATALOG_ERROR_CODES.fileTypeRejected, 415, ['file'])
}

/**
 * CatalogAssetService가 quarantine 파일을 공개 가능 자료인지 정적 검사한다.
 * 확장자·MIME·magic byte와 DOCX container 구조를 함께 확인하며 파일 내용을 실행하지 않는다.
 */
export class FileSafetyScanner {
  /** upload 직후 호출되어 canonical MIME을 반환하며, 조금이라도 모호하면 fail closed로 거부한다. */
  public async inspect(filePath: string, originalName: string, suppliedMime: string): Promise<string> {
    const extension = extname(originalName).toLowerCase()
    const allowed = ALLOWED_FILE_TYPES[extension]
    if (!allowed || !allowed.mimeAliases.includes(suppliedMime.toLowerCase())) reject()

    const handle = await open(filePath, 'r')
    const header = Buffer.alloc(16)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    await handle.close()
    const magic = header.subarray(0, bytesRead)

    if (extension === '.pdf' && !magic.subarray(0, 5).equals(Buffer.from('%PDF-'))) reject()
    if (extension === '.png' && !startsWith(magic, PNG_MAGIC)) reject()
    if ((extension === '.jpg' || extension === '.jpeg') && !(magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff)) reject()
    if (extension === '.webp' && !(magic.subarray(0, 4).toString('ascii') === 'RIFF' && magic.subarray(8, 12).toString('ascii') === 'WEBP')) reject()
    if (extension === '.doc' && !startsWith(magic, OLE_MAGIC)) reject()
    if (extension === '.txt') await this.assertUtf8Text(filePath)
    if (extension === '.docx') await this.assertSafeDocx(filePath, magic)
    return allowed.contentType
  }

  private async assertUtf8Text(filePath: string): Promise<void> {
    const handle = await open(filePath, 'r')
    try {
      const decoder = new TextDecoder('utf-8', { fatal: true })
      const buffer = Buffer.alloc(64 * 1024)
      let position = 0
      while (true) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
        if (bytesRead === 0) break
        const decoded = decoder.decode(buffer.subarray(0, bytesRead), { stream: true })
        if (decoded.includes('\0')) reject()
        position += bytesRead
      }
      decoder.decode()
    } catch (error) {
      if (error instanceof CatalogError) throw error
      reject()
    } finally {
      await handle.close()
    }
  }

  private async assertSafeDocx(filePath: string, magic: Buffer): Promise<void> {
    if (!(magic[0] === 0x50 && magic[1] === 0x4b)) reject()
    await new Promise<void>((resolve, rejectPromise) => {
      yauzl.open(filePath, { lazyEntries: true, validateEntrySizes: true }, (openError, zip) => {
        if (openError || !zip) return rejectPromise(new CatalogError(CATALOG_ERROR_CODES.fileTypeRejected, 415, ['file']))
        let entryCount = 0
        let totalBytes = 0
        let hasContentTypes = false
        let hasDocument = false
        zip.on('entry', (entry) => {
          entryCount += 1
          totalBytes += entry.uncompressedSize
          const name = entry.fileName.replaceAll('\\', '/').toLowerCase()
          const unsafePath = name.startsWith('/') || name.split('/').includes('..')
          const macro = name.endsWith('vbaproject.bin') || name.includes('/embeddings/')
          const suspiciousRatio = entry.compressedSize === 0 ? entry.uncompressedSize > 0 : entry.uncompressedSize / entry.compressedSize > ZIP_RATIO_MAX
          if (unsafePath || macro || suspiciousRatio || entryCount > ZIP_ENTRY_MAX_COUNT || totalBytes > ZIP_UNCOMPRESSED_MAX_BYTES) {
            zip.close()
            return rejectPromise(new CatalogError(CATALOG_ERROR_CODES.fileTypeRejected, 415, ['file']))
          }
          hasContentTypes ||= name === '[content_types].xml'
          hasDocument ||= name === 'word/document.xml'
          zip.readEntry()
        })
        zip.on('error', () => rejectPromise(new CatalogError(CATALOG_ERROR_CODES.fileTypeRejected, 415, ['file'])))
        zip.on('end', () => hasContentTypes && hasDocument ? resolve() : rejectPromise(new CatalogError(CATALOG_ERROR_CODES.fileTypeRejected, 415, ['file'])))
        zip.readEntry()
      })
    })
  }
}
