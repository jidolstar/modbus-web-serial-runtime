import { ApiProperty } from '@nestjs/swagger'
import { CATALOG_DOCUMENT_TYPES, CATALOG_LINK_TYPES } from './catalog.constants'

export class CatalogThumbnailResponseDto {
  @ApiProperty({ example: '4d7d9c4f18d1473f20f768a5ad458e3055dc951e6d8539d3117b03bf32834c8b' }) etag!: string // JPEG SHA-256 cache 식별자
  @ApiProperty({ example: 18420 }) byteSize!: number // 변환된 300×300 JPEG 크기
  @ApiProperty({ example: 'image/jpeg' }) contentType!: 'image/jpeg' // 고정 결과 MIME
}

export class CatalogFileDto {
  @ApiProperty({ example: 12 }) id!: number // 파일 metadata ID
  @ApiProperty({ example: 'RS485 통신 프로토콜' }) title!: string // 사람이 읽는 제목
  @ApiProperty({ enum: CATALOG_DOCUMENT_TYPES, example: 'communication_protocol' }) documentType!: string // 문서 용도 enum
  @ApiProperty({ example: 'protocol.pdf' }) originalName!: string // 경로를 제거한 원본 파일명
  @ApiProperty({ example: 'application/pdf' }) contentType!: string // 검증된 canonical MIME
  @ApiProperty({ example: 240123 }) byteSize!: number // 실제 upload byte 수
  @ApiProperty({ example: '08e5a4ddab908d66bc10c402485af267e450d2c0f5f672b7757262f92642fd3b' }) sha256!: string // 무결성 hash
  @ApiProperty({ enum: ['pending', 'clean', 'rejected', 'failed'], example: 'clean' }) status!: string // clean만 다운로드 가능
  @ApiProperty({ example: '2026-09-23T00:00:00.000Z' }) createdAt!: string // UTC ISO 8601 등록 시각
}

export class CatalogLinkWriteDto {
  @ApiProperty({ example: '제조사 제품 페이지', maxLength: 160 }) title!: string // 사람이 읽는 링크 제목
  @ApiProperty({ enum: CATALOG_LINK_TYPES, example: 'official_website' }) linkType!: string // 링크 용도 enum
  @ApiProperty({ example: 'https://example.com/products/temp-100', maxLength: 2048 }) url!: string // 저장만 하는 public HTTPS URL
}

export class CatalogLinkDto extends CatalogLinkWriteDto {
  @ApiProperty({ example: 5 }) id!: number // 링크 metadata ID
  @ApiProperty({ example: '2026-09-23T00:00:00.000Z' }) createdAt!: string // UTC ISO 8601 생성 시각
  @ApiProperty({ example: '2026-09-23T01:00:00.000Z' }) updatedAt!: string // UTC ISO 8601 수정 시각
}
