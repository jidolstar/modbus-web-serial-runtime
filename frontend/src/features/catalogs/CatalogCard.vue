<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import { catalogApi, type CatalogSummary } from '../../device-catalog/catalog-api'
import HelpTooltip from '../../components/HelpTooltip.vue'
import { HELP_TOOLTIP_COPY } from '../../components/help-tooltip-copy'

const props = defineProps<{ readonly catalog: CatalogSummary }>()
defineEmits<{ view: [] }>()
const thumbnailUrl = ref<string | null>(null)

onMounted(async () => {
  try {
    const blob = await catalogApi.getThumbnailBlob(props.catalog.catalogKey)
    if (blob) thumbnailUrl.value = URL.createObjectURL(blob)
  } catch { /* 썸네일 실패는 Catalog 목록 자체를 막지 않는다. */ }
})
onBeforeUnmount(() => { if (thumbnailUrl.value) URL.revokeObjectURL(thumbnailUrl.value) })
</script>

<template>
  <article class="catalog-list-row">
    <div class="catalog-thumbnail" :class="{ placeholder: !thumbnailUrl }">
      <img v-if="thumbnailUrl" :src="thumbnailUrl" :alt="`${catalog.title} 썸네일`">
      <span v-else aria-hidden="true">▦</span>
    </div>
    <div class="catalog-card-body">
      <div class="catalog-card-heading"><div><h2>{{ catalog.title }}</h2><p>{{ catalog.manufacturer }} · {{ catalog.model }}</p></div></div>
      <div class="catalog-list-meta"><span class="help-label">Catalog key <HelpTooltip label="Catalog key" :text="HELP_TOOLTIP_COPY.catalogKey" /> {{ catalog.catalogKey }}</span><span class="help-label">Revision <HelpTooltip label="Revision" :text="HELP_TOOLTIP_COPY.revision" /> {{ catalog.revision }}</span></div>
      <p v-if="catalog.usesExtensions" class="adapter-note help-label">전용 capability adapter 선언 포함 <HelpTooltip label="Capability adapter" :text="HELP_TOOLTIP_COPY.capabilityAdapter" /></p>
    </div>
    <span class="catalog-card-status"><span class="status-pill" :class="catalog.enabled ? 'success' : 'muted'">{{ catalog.enabled ? '활성' : '비활성' }}</span><HelpTooltip label="카탈로그 상태" :text="HELP_TOOLTIP_COPY.catalogStatus" /></span>
    <button class="button button-ghost button-small" type="button" @click="$emit('view')">상세 보기</button>
  </article>
</template>
