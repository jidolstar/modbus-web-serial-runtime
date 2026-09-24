<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps<{
  readonly label: string
  readonly text: string
}>()

const OPEN_EVENT = 'modbus-manager:help-tooltip-open'
const GAP = 8
const VIEWPORT_MARGIN = 12
const MAX_WIDTH = 280
const id = `help-tooltip-${Math.random().toString(36).slice(2)}`
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const tooltip = ref<HTMLElement | null>(null)
const open = ref(false)
const pinned = ref(false)
const hovered = ref(false)
const focused = ref(false)
const position = ref({ top: 0, left: 0 })
let closeTimer: number | undefined

const tooltipStyle = computed(() => ({ top: `${position.value.top}px`, left: `${position.value.left}px` }))

/** 화면 가장자리와 실제 툴팁 크기를 반영해 Teleport된 도움말이 잘리지 않게 배치한다. */
async function updatePosition(): Promise<void> {
  await nextTick()
  if (!trigger.value || !tooltip.value) return
  const triggerRect = trigger.value.getBoundingClientRect()
  const tooltipRect = tooltip.value.getBoundingClientRect()
  const width = Math.min(tooltipRect.width || MAX_WIDTH, window.innerWidth - VIEWPORT_MARGIN * 2)
  const left = Math.min(Math.max(triggerRect.left, VIEWPORT_MARGIN), window.innerWidth - width - VIEWPORT_MARGIN)
  const belowTop = triggerRect.bottom + GAP
  const top = belowTop + tooltipRect.height <= window.innerHeight - VIEWPORT_MARGIN
    ? belowTop
    : Math.max(VIEWPORT_MARGIN, triggerRect.top - tooltipRect.height - GAP)
  position.value = { top, left }
}

function show(pin = false): void {
  if (closeTimer !== undefined) window.clearTimeout(closeTimer)
  pinned.value = pinned.value || pin
  open.value = true
  window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: id }))
  void updatePosition()
}

/** 포인터가 버튼과 설명 사이를 이동할 때 깜빡이지 않도록 잠시 기다린 뒤 닫힘 여부를 판단한다. */
function scheduleClose(): void {
  if (closeTimer !== undefined) window.clearTimeout(closeTimer)
  closeTimer = window.setTimeout(() => {
    if (!pinned.value && !hovered.value && !focused.value) open.value = false
  }, 100)
}

function togglePinned(): void {
  if (pinned.value && open.value) {
    pinned.value = false
    open.value = false
    return
  }
  show(true)
}

function close(): void {
  pinned.value = false
  open.value = false
}

function handleOutsidePointer(event: PointerEvent): void {
  if (!pinned.value) return
  const target = event.target
  if (!(target instanceof Node) || root.value?.contains(target) || tooltip.value?.contains(target)) return
  close()
}

function handleOtherTooltip(event: Event): void {
  if ((event as CustomEvent<string>).detail !== id) close()
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape' || !open.value) return
  close()
  trigger.value?.focus()
}

onMounted(() => {
  document.addEventListener('pointerdown', handleOutsidePointer)
  document.addEventListener('keydown', handleEscape)
  window.addEventListener(OPEN_EVENT, handleOtherTooltip)
  window.addEventListener('resize', updatePosition)
  window.addEventListener('scroll', updatePosition, true)
})

onBeforeUnmount(() => {
  if (closeTimer !== undefined) window.clearTimeout(closeTimer)
  document.removeEventListener('pointerdown', handleOutsidePointer)
  document.removeEventListener('keydown', handleEscape)
  window.removeEventListener(OPEN_EVENT, handleOtherTooltip)
  window.removeEventListener('resize', updatePosition)
  window.removeEventListener('scroll', updatePosition, true)
})
</script>

<template>
  <span ref="root" class="help-tooltip">
    <button
      ref="trigger"
      class="help-tooltip-trigger"
      type="button"
      :aria-label="`${label} 도움말`"
      :aria-describedby="open ? id : undefined"
      :aria-expanded="open"
      @mouseenter="hovered = true; show()"
      @mouseleave="hovered = false; scheduleClose()"
      @focus="focused = true; show()"
      @blur="focused = false; scheduleClose()"
      @click.stop.prevent="togglePinned"
    >?</button>
    <Teleport to="body">
      <span
        v-if="open"
        :id="id"
        ref="tooltip"
        class="help-tooltip-content"
        role="tooltip"
        :style="tooltipStyle"
        @mouseenter="hovered = true"
        @mouseleave="hovered = false; scheduleClose()"
      >{{ text }}</span>
    </Teleport>
  </span>
</template>
