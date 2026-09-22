import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

/** 쉼표 구분 host 목록에서 공백과 빈 항목을 제거한다. */
function parseAllowedHosts(rawAllowedHosts: string): string[] {
  return rawAllowedHosts.split(',').map((host) => host.trim()).filter(Boolean)
}

export default defineConfig(({ mode }) => {
  /** 로컬 직접 실행에서도 repository root의 단일 .env를 읽는다. */
  const rootEnvironment = loadEnv(mode, '..', '')
  const allowedHostsSetting = process.env.VITE_ALLOWED_HOSTS
    ?? rootEnvironment.VITE_ALLOWED_HOSTS
    ?? 'localhost,modbus-frontend'

  return {
    envDir: '..',
    plugins: [vue()],
    server: {
      host: '0.0.0.0',
      port: 5173,
      allowedHosts: parseAllowedHosts(allowedHostsSetting),
    },
  }
})
