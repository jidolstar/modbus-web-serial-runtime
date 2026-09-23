/**
 * 브라우저 Frontend가 실제 관리 API에서 사용하는 HTTP method만 CORS preflight에 공개한다.
 * PUT·PATCH·DELETE를 생략하면 브라우저가 썸네일 교체나 상태 변경 요청을 Backend에 보내기 전에 차단한다.
 */
export const CORS_ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const
