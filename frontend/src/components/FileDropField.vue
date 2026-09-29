<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  id: string
  accept?: string
  multiple?: boolean
  compact?: boolean
  disabled?: boolean
  prompt?: string
  browseLabel?: string
}>(), {
  accept: undefined,
  multiple: false,
  compact: false,
  disabled: false,
  prompt: '파일을 여기에 끌어놓거나',
  browseLabel: '파일 선택',
})

const emit = defineEmits<{ files: [files: readonly File[]] }>()
const input = ref<HTMLInputElement>()
const dragDepth = ref(0)
const dragging = ref(false)

/**
 * 이 component는 브라우저가 전달한 File 선택만 부모에게 알린다.
 * 확장자·용량·파일 내용의 신뢰 여부는 사용처와 Backend가 각각 검증한다.
 */
function emitFiles(files: FileList | null): void {
  if (!files || props.disabled) return
  const selected = Array.from(files)
  emit('files', props.multiple ? selected : selected.slice(0, 1))
  // 같은 파일을 다시 고를 때도 change가 발생하도록 native input을 초기화한다.
  if (input.value) input.value.value = ''
}

function enterDrag(event: DragEvent): void {
  if (props.disabled || !event.dataTransfer?.types.includes('Files')) return
  dragDepth.value += 1
  dragging.value = true
}

function leaveDrag(): void {
  dragDepth.value = Math.max(0, dragDepth.value - 1)
  if (dragDepth.value === 0) dragging.value = false
}

function dropFiles(event: DragEvent): void {
  dragDepth.value = 0
  dragging.value = false
  emitFiles(event.dataTransfer?.files ?? null)
}
</script>

<template>
  <div
    class="file-drop-field"
    :class="{ 'is-dragging': dragging, 'is-disabled': disabled, 'is-compact': compact }"
    @dragenter.prevent="enterDrag"
    @dragover.prevent
    @dragleave.prevent="leaveDrag"
    @drop.prevent="dropFiles"
  >
    <span>{{ prompt }}</span>
    <label class="button button-ghost button-small" :for="id">{{ browseLabel }}</label>
    <input
      :id="id"
      ref="input"
      class="sr-only"
      type="file"
      :accept="accept"
      :multiple="multiple"
      :disabled="disabled"
      @change="emitFiles(($event.target as HTMLInputElement).files)"
    >
  </div>
</template>
