<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { catalogApi } from '../../device-catalog/catalog-api'
import FileDropField from '../../components/FileDropField.vue'
import HelpTooltip from '../../components/HelpTooltip.vue'
import { HELP_TOOLTIP_COPY } from '../../components/help-tooltip-copy'

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
/** 파일 선택과 drag-and-drop이 공통으로 호출하며, 업로드 전 로컬 미리보기만 교체한다. 실제 형식 검증은 Backend가 다시 수행한다. */
function choose(files: readonly File[]): void {
  const file = files[0] ?? null
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
    <div class="section-heading"><div><h3 class="help-label">제품 썸네일 <HelpTooltip label="제품 썸네일" :text="HELP_TOOLTIP_COPY.thumbnail" /></h3><p>서버가 중앙 기준 300×300 JPEG로 변환합니다.</p></div></div>
    <div class="thumbnail-editor">
      <div class="thumbnail-preview" :class="{ placeholder: !imageUrl }"><img v-if="imageUrl" :src="imageUrl" alt="변환될 제품 썸네일 미리보기"><span v-else>이미지 없음</span></div>
      <div class="field-stack">
        <span class="field-label">새 이미지</span>
        <FileDropField
          id="catalog-thumbnail-file"
          class="thumbnail-file-drop"
          accept="image/png,image/jpeg,image/webp"
          compact
          :disabled="busy"
          prompt="PNG, JPEG 또는 WebP 이미지를 이 영역에 끌어놓거나 파일 선택 버튼을 눌러 주세요."
          @files="choose"
        />
        <small v-if="selectedFile">선택됨: {{ selectedFile.name }} · {{ Math.ceil(selectedFile.size / 1024) }}KB</small>
        <button class="button button-primary" type="button" :disabled="!selectedFile || busy" @click="upload">{{ busy ? '업로드 중…' : '등록·교체' }}</button>
        <small>삭제 기능은 제공하지 않으며 다른 이미지로 교체할 수 있습니다.</small>
      </div>
    </div>
  </section>
</template>
