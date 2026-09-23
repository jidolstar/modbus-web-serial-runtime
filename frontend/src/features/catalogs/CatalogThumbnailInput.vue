<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { catalogApi } from '../../device-catalog/catalog-api'

const props = defineProps<{ readonly catalogKey: string }>()
const emit = defineEmits<{ changed: []; error: [message: string] }>()
const imageUrl = ref<string | null>(null)
const selectedFile = ref<File | null>(null)
const busy = ref(false)

function replaceUrl(blob: Blob | null): void {
  if (imageUrl.value) URL.revokeObjectURL(imageUrl.value)
  imageUrl.value = blob ? URL.createObjectURL(blob) : null
}
async function load(): Promise<void> {
  try { replaceUrl(await catalogApi.getThumbnailBlob(props.catalogKey)) } catch { emit('error', '썸네일을 불러오지 못했습니다.') }
}
function choose(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0] ?? null
  selectedFile.value = file
  if (file) replaceUrl(file)
}
async function upload(): Promise<void> {
  if (!selectedFile.value || busy.value) return
  busy.value = true
  try {
    await catalogApi.replaceThumbnail(props.catalogKey, selectedFile.value)
    selectedFile.value = null
    await load(); emit('changed')
  } catch { emit('error', 'PNG, JPEG 또는 WebP 이미지를 확인해 주세요.') } finally { busy.value = false }
}
onMounted(load)
onBeforeUnmount(() => { if (imageUrl.value) URL.revokeObjectURL(imageUrl.value) })
</script>

<template>
  <section class="asset-section">
    <div class="section-heading"><div><h3>제품 썸네일</h3><p>서버가 중앙 기준 300×300 JPEG로 변환합니다.</p></div></div>
    <div class="thumbnail-editor">
      <div class="thumbnail-preview" :class="{ placeholder: !imageUrl }"><img v-if="imageUrl" :src="imageUrl" alt="변환될 제품 썸네일 미리보기"><span v-else>이미지 없음</span></div>
      <div class="field-stack"><label>새 이미지<input type="file" accept="image/png,image/jpeg,image/webp" @change="choose"></label><button class="button button-primary" type="button" :disabled="!selectedFile || busy" @click="upload">{{ busy ? '업로드 중…' : '등록·교체' }}</button><small>삭제 기능은 제공하지 않으며 다른 이미지로 교체할 수 있습니다.</small></div>
    </div>
  </section>
</template>
