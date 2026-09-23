export const CATALOG_TITLE_MAX_LENGTH = 160 // 사람용 Catalog 제목 최대 길이. 예: 160자
export const CATALOG_SEARCH_MAX_LENGTH = 100 // 목록 검색어 최대 길이. 예: 100자
export const CATALOG_LIST_DEFAULT_LIMIT = 20 // limit을 생략했을 때 반환할 개수. 예: 20개
export const CATALOG_LIST_MAX_LIMIT = 100 // 한 요청에서 반환할 최대 개수. 예: 100개
export const CATALOG_DEFINITION_MAX_BYTES = 256 * 1024 // Bundle JSON 최대 UTF-8 크기. 예: 262144 bytes

export const CATALOG_ERROR_CODES = Object.freeze({
  invalidInput: 'CATALOG_INVALID_INPUT', // DTO 또는 JSON Schema 검증 실패. 예: title 누락
  duplicateKey: 'CATALOG_KEY_CONFLICT', // 이미 등록된 profile.id. 예: "cwt-th04s"
  notFound: 'CATALOG_NOT_FOUND', // 요청한 catalogKey가 존재하지 않음
  revisionConflict: 'CATALOG_REVISION_CONFLICT', // 오래된 revision으로 수정 시도. 예: 2 대신 현재 3
})
