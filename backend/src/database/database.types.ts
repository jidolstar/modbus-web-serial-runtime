import { ColumnType, Generated } from 'kysely'
import type { CatalogBundle } from '@modbus-manager/device-catalog-domain'

export interface UsersTable {
  id: Generated<number>
  google_subject: string
  email: string
  display_name: string | null
  avatar_url: string | null
  last_login_at: Date
  disabled_at: Date | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface AuthSessionsTable {
  id: Generated<number>
  user_id: number
  token_jti_hash: string
  expires_at: Date
  revoked_at: Date | null
  created_at: Generated<Date>
  last_seen_at: Date | null
}

/** DB가 보관하는 재사용 가능한 장비 모델 정의다. CatalogRepository만 이 row 형식을 직접 사용한다. */
export interface CatalogsTable {
  id: Generated<number> // 내부 FK에 사용할 숫자 ID. 예: 42
  catalog_key: string // Profile ID에서 파생한 안정 식별자. 예: "cwt-th04s"
  title: string // 관리 화면에서 사람이 식별하는 제목. 예: "CWT 온습도 센서"
  schema_version: string // Bundle 계약 버전. 예: "1.0"
  manufacturer: string // 목록 검색용 제조사 파생값. 예: "CWT"
  model: string // 목록 검색용 모델 파생값. 예: "CWT-TH04S"
  definition_json: ColumnType<CatalogBundle | string, string, string> // MySQL JSON 원문. write는 JSON 문자열, read는 driver에 따라 객체 또는 문자열
  revision: Generated<number> // 동시 수정 충돌을 막는 증가 번호. 예: 3
  enabled: Generated<boolean> // true이면 실행용 Catalog 후보에 포함됨. 예: true
  created_by_user_id: number // 최초 등록 사용자 FK. 예: 7
  updated_by_user_id: number // 마지막 수정 사용자 FK. 예: 7
  created_at: Generated<Date> // 최초 등록 시각(UTC 저장). 예: 2026-09-23T00:00:00Z
  updated_at: Generated<Date> // 마지막 수정 시각(UTC 저장). 예: 2026-09-23T01:00:00Z
}

export type CatalogDocumentType = 'communication_protocol' | 'manual' | 'datasheet' | 'reference_image' | 'other'
export type CatalogFileStatus = 'pending' | 'clean' | 'rejected' | 'failed'
export type CatalogLinkType = 'official_website' | 'manufacturer_page' | 'documentation' | 'reference'

/** Catalog 목록·상세에 표시할 300×300 JPEG 한 개의 저장 metadata다. */
export interface CatalogThumbnailsTable {
  catalog_id: number // catalog FK. Catalog당 한 row만 존재한다.
  storage_key: string // volume 내부 무작위 key. 예: "thumbnails/42/uuid.jpg"
  content_type: 'image/jpeg' // 재인코딩된 결과 MIME. 항상 image/jpeg
  byte_size: number // 변환 결과 크기. 예: 18420
  etag: string // 캐시 검증용 SHA-256 기반 ETag 값
  updated_by_user_id: number // 마지막 교체 사용자 FK. 예: 7
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

/** Catalog에 첨부한 참고 문서의 검증 상태와 안전한 저장 위치다. */
export interface CatalogFilesTable {
  id: Generated<number>
  catalog_id: number // 소속 Catalog FK. 예: 42
  title: string // 화면 표시 제목. 예: "통신 프로토콜 설명서"
  document_type: CatalogDocumentType // 자료 용도 enum. 예: "communication_protocol"
  original_name: string // 경로를 제거한 원본 파일명. 예: "protocol.pdf"
  storage_key: string // volume 내부 무작위 key. 사용자 입력을 포함하지 않는다.
  content_type: string // 검증된 MIME. 예: "application/pdf"
  byte_size: number // 업로드 크기. 예: 240123
  sha256: string // 무결성 확인용 hex digest
  status: CatalogFileStatus // clean만 다운로드 가능. 예: "clean"
  rejection_code: string | null // 공개 가능한 판정 코드. 예: "FILE_TYPE_MISMATCH"
  created_by_user_id: number
  created_at: Generated<Date>
}

/** 서버가 방문하지 않고 표시만 하는 Catalog 참고 HTTPS 링크다. */
export interface CatalogLinksTable {
  id: Generated<number>
  catalog_id: number
  title: string // 사람이 읽는 링크 제목. 예: "제조사 제품 페이지"
  link_type: CatalogLinkType // 링크 용도 enum. 예: "official_website"
  url: string // 검증된 public HTTPS URL. 예: "https://example.com/products/temp-100"
  created_by_user_id: number
  updated_by_user_id: number
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

export interface DatabaseSchema {
  users: UsersTable
  auth_sessions: AuthSessionsTable
  catalog: CatalogsTable
  catalog_thumbnails: CatalogThumbnailsTable
  catalog_files: CatalogFilesTable
  catalog_links: CatalogLinksTable
}
