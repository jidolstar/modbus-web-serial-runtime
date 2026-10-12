<script setup lang="ts">
import { onUnmounted } from 'vue'
import { activeToast, dismissToast } from './toast'

onUnmounted(dismissToast)
</script>

<template>
  <Transition name="toast">
    <div
      v-if="activeToast"
      class="toast-viewport"
      :class="`toast-${activeToast.kind}`"
      :key="activeToast.id"
      :role="activeToast.kind === 'error' ? 'alert' : 'status'"
      :aria-live="activeToast.kind === 'error' ? 'assertive' : 'polite'"
    >
      <span>{{ activeToast.message }}</span>
      <button type="button" aria-label="알림 닫기" @click="dismissToast">×</button>
    </div>
  </Transition>
</template>
