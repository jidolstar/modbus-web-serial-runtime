import { computed, readonly, ref } from 'vue'
import { authApi } from './auth-api'
import type { AuthUser } from './auth-api'

export type AuthState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'configuration-missing'; readonly missing: readonly string[] }
  | { readonly kind: 'anonymous' }
  | { readonly kind: 'authenticated'; readonly user: AuthUser }
  | { readonly kind: 'error' }

export function useAuthSession() {
  const state = ref<AuthState>({ kind: 'loading' })
  const isLoggingOut = ref(false)

  async function bootstrap(): Promise<void> {
    state.value = { kind: 'loading' }
    try {
      const configuration = await authApi.getConfiguration()
      if (!configuration.configured) {
        state.value = { kind: 'configuration-missing', missing: configuration.missing }
        return
      }
      const user = await authApi.getCurrentUser()
      state.value = user ? { kind: 'authenticated', user } : { kind: 'anonymous' }
    } catch {
      state.value = { kind: 'error' }
    }
  }

  function login(): void {
    window.location.assign(authApi.loginUrl)
  }

  async function logout(): Promise<void> {
    if (isLoggingOut.value) return
    isLoggingOut.value = true
    try {
      await authApi.logout()
      state.value = { kind: 'anonymous' }
    } catch {
      state.value = { kind: 'error' }
    } finally {
      isLoggingOut.value = false
    }
  }

  return {
    state: readonly(state),
    isLoggingOut: computed(() => isLoggingOut.value),
    bootstrap,
    login,
    logout,
  }
}
