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

export interface DevicesTable {
  id: Generated<number>
  created_by_user_id: number
  name: string
  profile_id: string
  slave_id: number
  baud_rate: number
  data_bits: number
  stop_bits: number
  parity: 'none' | 'even' | 'odd'
  enabled: Generated<boolean>
  notes: string | null
  created_at: Generated<Date>
  updated_at: Generated<Date>
}

/** DB가 보관하는 재사용 가능한 장비 모델 정의다. CatalogRepository만 이 row 형식을 직접 사용한다. */
export interface DeviceCatalogsTable {
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

export interface DatabaseSchema {
  users: UsersTable
  auth_sessions: AuthSessionsTable
  devices: DevicesTable
  device_catalogs: DeviceCatalogsTable
}
