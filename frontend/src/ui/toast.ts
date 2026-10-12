import { ref } from 'vue'

export type ToastKind = 'error' | 'success' | 'info'

export interface ToastMessage {
  readonly id: number
  readonly message: string
  readonly kind: ToastKind
}

export const activeToast = ref<ToastMessage | null>(null)

let nextToastId = 0
let dismissTimer: ReturnType<typeof setTimeout> | undefined

/** 화면 어디서나 결과를 알리고 ToastViewport가 자동으로 닫히도록 공유 상태를 갱신한다. */
export function showToast(message: string, kind: ToastKind = 'info', durationMs = 5000): void {
  if (dismissTimer) clearTimeout(dismissTimer)

  const id = ++nextToastId
  activeToast.value = { id, message, kind }
  dismissTimer = setTimeout(() => {
    if (activeToast.value?.id === id) activeToast.value = null
    dismissTimer = undefined
  }, durationMs)
}

/** 사용자가 닫거나 앱이 Toast를 정리할 때 대기 중인 자동 닫힘 timer도 함께 정리한다. */
export function dismissToast(): void {
  if (dismissTimer) clearTimeout(dismissTimer)
  dismissTimer = undefined
  activeToast.value = null
}
