<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'

defineProps<{ readonly discarding: boolean }>()
const emit = defineEmits<{ continue: []; discard: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)

// Esc는 즉시 폐기하지 않고 부모의 작성 화면으로 돌아가게 한다. 실제 자원 삭제는 명시적 작성 취소에서만 시작한다.
onMounted(() => dialog.value?.showModal())
// 정리 완료나 계속 작성으로 component가 사라질 때 native modal 상태도 함께 닫는다.
onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog ref="dialog" class="ai-review-dialog ai-cancel-dialog" @cancel.prevent="emit('continue')">
    <article class="ai-review-card">
      <header>
        <div>
          <p class="eyebrow">CANCEL AI CATALOG</p>
          <h2>AI 카탈로그 작성을 취소할까요?</h2>
        </div>
      </header>
      <p>입력한 요구사항, 생성 결과와 임시 첨부 자료를 더 이상 이 화면에서 사용할 수 없습니다. 서버의 AI 세션과 Gemini에 업로드한 파일도 정리합니다.</p>
      <p class="description">요청·응답 감사 기록은 운영 정책에 따라 DB에 유지됩니다.</p>
      <footer>
        <button class="button button-ghost" type="button" :disabled="discarding" @click="emit('continue')">계속 작성</button>
        <button class="button danger" type="button" :disabled="discarding" @click="emit('discard')">{{ discarding ? '정리 중…' : '작성 취소' }}</button>
      </footer>
    </article>
  </dialog>
</template>
