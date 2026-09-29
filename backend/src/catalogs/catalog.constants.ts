export const CATALOG_TITLE_MAX_LENGTH = 160 // 사람용 Catalog 제목 최대 길이. 예: 160자
export const CATALOG_SEARCH_MAX_LENGTH = 100 // 목록 검색어 최대 길이. 예: 100자
export const CATALOG_LIST_DEFAULT_LIMIT = 20 // limit을 생략했을 때 반환할 개수. 예: 20개
export const CATALOG_LIST_MAX_LIMIT = 100 // 한 요청에서 반환할 최대 개수. 예: 100개
export const CATALOG_DEFINITION_MAX_BYTES = 256 * 1024 // Bundle JSON 최대 UTF-8 크기. 예: 262144 bytes
export const CATALOG_ASSET_TITLE_MAX_LENGTH = 160 // 파일·링크 표시 제목 최대 길이. 예: 160자
export const CATALOG_LINK_URL_MAX_LENGTH = 2_048 // HTTPS 참고 URL 최대 길이. 예: 2048자
export const CATALOG_ORIGINAL_NAME_MAX_LENGTH = 255 // 경로 제거 후 보관할 원본 파일명 최대 길이. 예: 255자

export const CATALOG_DOCUMENT_TYPES = ['communication_protocol', 'manual', 'datasheet', 'reference_image', 'other'] as const
export const CATALOG_LINK_TYPES = ['official_website', 'manufacturer_page', 'documentation', 'reference', 'retailer'] as const

export const CATALOG_ERROR_CODES = Object.freeze({
  invalidInput: 'CATALOG_INVALID_INPUT', // DTO 또는 JSON Schema 검증 실패. 예: title 누락
  duplicateKey: 'CATALOG_KEY_CONFLICT', // 이미 등록된 profile.id. 예: "cwt-th04s"
  notFound: 'CATALOG_NOT_FOUND', // 요청한 catalogKey가 존재하지 않음
  revisionConflict: 'CATALOG_REVISION_CONFLICT', // 오래된 revision으로 수정 시도. 예: 2 대신 현재 3
  assetInvalidInput: 'CATALOG_ASSET_INVALID_INPUT', // 제목·enum·URL·multipart 입력 오류
  fileTooLarge: 'CATALOG_FILE_TOO_LARGE', // 설정된 upload byte 상한 초과
  fileTypeRejected: 'CATALOG_FILE_TYPE_REJECTED', // 확장자·MIME·magic 또는 container 검사 실패
  fileNotClean: 'CATALOG_FILE_NOT_CLEAN', // clean 이외 상태의 다운로드 시도
  assetNotFound: 'CATALOG_ASSET_NOT_FOUND', // 파일 또는 링크 ID가 Catalog에 없음
  aiNotConfigured: 'CATALOG_AI_NOT_CONFIGURED',
  aiInvalidInput: 'CATALOG_AI_INVALID_INPUT',
  aiJobNotFound: 'CATALOG_AI_JOB_NOT_FOUND',
  aiJobNotReady: 'CATALOG_AI_JOB_NOT_READY',
  aiRateLimited: 'CATALOG_AI_RATE_LIMITED',
  aiUpstreamTimeout: 'CATALOG_AI_UPSTREAM_TIMEOUT',
  aiUpstreamFailed: 'CATALOG_AI_UPSTREAM_FAILED',
  aiUpstreamUnavailable: 'CATALOG_AI_UPSTREAM_UNAVAILABLE', // Gemini model의 일시적 과부하 또는 서비스 불가
  aiAccessDenied: 'CATALOG_AI_ACCESS_DENIED', // Gemini API key 또는 model 접근 권한 부족
  aiModelUnavailable: 'CATALOG_AI_MODEL_UNAVAILABLE', // 설정한 model을 API project에서 사용할 수 없음
  aiInvalidResponse: 'CATALOG_AI_INVALID_RESPONSE',
  aiAuditFailed: 'CATALOG_AI_AUDIT_FAILED',
})
