/** Browser에 공개되는 API base URL을 HTTPS origin·path로 제한하고 trailing slash를 정규화한다. */
export function parseApiBaseUrl(rawValue: string | undefined): URL {
  if (!rawValue?.trim()) throw new Error('VITE_API_BASE_URL 설정이 필요합니다.')
  const url = new URL(rawValue)
  const isLocalDevelopment = ['localhost', '127.0.0.1'].includes(url.hostname)
  if (url.protocol !== 'https:' && !(isLocalDevelopment && url.protocol === 'http:')) throw new Error('VITE_API_BASE_URL은 HTTPS URL이어야 합니다.')
  if (url.username || url.password || url.search || url.hash) throw new Error('VITE_API_BASE_URL에는 credential, query 또는 fragment를 사용할 수 없습니다.')
  url.pathname = `${url.pathname.replace(/\/$/, '')}/`
  return url
}
