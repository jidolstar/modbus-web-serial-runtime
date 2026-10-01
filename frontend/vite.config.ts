import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

/** 쉼표 구분 host 목록에서 공백과 빈 항목을 제거한다. */
function parseAllowedHosts(rawAllowedHosts: string): string[] {
  return rawAllowedHosts.split(',').map((host) => host.trim()).filter(Boolean)
}

/** CORS가 허용한 Frontend origin만 사용하고, 개발용 HTTP 주소는 검색용 URL로 내보내지 않는다. */
function parsePublicSiteOrigin(rawSiteUrl: string | undefined): string | undefined {
  if (!rawSiteUrl?.trim()) return undefined

  let siteUrl: URL
  try {
    siteUrl = new URL(rawSiteUrl)
  } catch {
    throw new Error('CORS_ORIGIN은 Frontend의 정확한 HTTP(S) origin이어야 합니다.')
  }

  if (
    !['http:', 'https:'].includes(siteUrl.protocol)
    || siteUrl.username !== ''
    || siteUrl.password !== ''
    || siteUrl.pathname !== '/'
    || siteUrl.search !== ''
    || siteUrl.hash !== ''
  ) {
    throw new Error('CORS_ORIGIN에는 인증정보와 경로 없이 정확한 HTTP(S) origin만 지정해야 합니다.')
  }
  return siteUrl.protocol === 'https:' ? siteUrl.origin : undefined
}

export default defineConfig(({ mode }) => {
  /** 로컬 직접 실행에서도 repository root의 단일 .env를 읽는다. */
  const rootEnvironment = loadEnv(mode, '..', '')
  const allowedHostsSetting = process.env.VITE_ALLOWED_HOSTS
    ?? rootEnvironment.VITE_ALLOWED_HOSTS
    ?? 'localhost,modbus-frontend'
  // Backend 로그인/CORS와 같은 Frontend origin을 써 도메인 설정이 서로 어긋나지 않게 한다.
  const publicSiteOrigin = parsePublicSiteOrigin(process.env.CORS_ORIGIN ?? rootEnvironment.CORS_ORIGIN)

  return {
    envDir: '..',
    plugins: [vue(), {
      name: 'inject-public-site-origin',
      transformIndexHtml(html) {
        const publicUrlMetadata = /<!-- PUBLIC_SITE_URL_START -->[\s\S]*?<!-- PUBLIC_SITE_URL_END -->/
        if (!publicSiteOrigin) return html.replace(publicUrlMetadata, '')

        return html.replace(publicUrlMetadata, (metadata) => metadata
          .replaceAll('__PUBLIC_SITE_ORIGIN__', publicSiteOrigin)
          .replace(/<!--[\s\S]*?-->/g, ''))
      },
    }],
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: parseAllowedHosts(allowedHostsSetting),
    },
  }
})
