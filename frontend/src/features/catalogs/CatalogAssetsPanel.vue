<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { catalogApi, type CatalogFileItem, type CatalogLinkInput, type CatalogLinkItem } from '../../device-catalog/catalog-api'

const props = defineProps<{ readonly catalogKey: string; readonly mode: 'files' | 'links' }>()
const emit = defineEmits<{ error: [message: string] }>()
const files = ref<CatalogFileItem[]>([]); const links = ref<CatalogLinkItem[]>([]); const busy = ref(false)
const fileTitle = ref(''); const documentType = ref('communication_protocol'); const selectedFile = ref<File | null>(null)
const linkTitle = ref(''); const linkType = ref('official_website'); const linkUrl = ref(''); const editingLinkId = ref<number | null>(null)

/** 파일·링크 전용 수정 화면이 마운트되거나 저장을 마친 뒤 현재 화면의 자료만 다시 읽는다. */
async function refresh(): Promise<void> {
  try {
    if (props.mode === 'files') files.value = await catalogApi.listFiles(props.catalogKey)
    else links.value = await catalogApi.listLinks(props.catalogKey)
  }
  catch { emit('error', '첨부 자료를 불러오지 못했습니다.') }
}
function chooseFile(event: Event): void { selectedFile.value = (event.target as HTMLInputElement).files?.[0] ?? null }
async function uploadFile(): Promise<void> {
  if (!selectedFile.value || !fileTitle.value.trim() || busy.value) return
  busy.value = true
  try { await catalogApi.uploadFile(props.catalogKey, fileTitle.value.trim(), documentType.value, selectedFile.value); fileTitle.value = ''; selectedFile.value = null; await refresh() }
  catch { emit('error', '파일 형식, 제목 또는 크기를 확인해 주세요.') } finally { busy.value = false }
}
async function download(file: CatalogFileItem): Promise<void> {
  try {
    const blob = await catalogApi.downloadFile(props.catalogKey, file); const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = file.originalName; anchor.click()
    // 브라우저가 다운로드를 시작하기 전에 object URL을 해제하지 않도록 다음 task에서 정리한다.
    setTimeout(() => URL.revokeObjectURL(url), 0)
  } catch { emit('error', 'clean 상태의 파일만 다운로드할 수 있습니다.') }
}
async function removeFile(file: CatalogFileItem): Promise<void> { if (!confirm(`'${file.title}' 파일을 삭제할까요?`)) return; try { await catalogApi.deleteFile(props.catalogKey, file.id); await refresh() } catch { emit('error', '파일을 삭제하지 못했습니다.') } }
function editLink(link: CatalogLinkItem): void { editingLinkId.value = link.id; linkTitle.value = link.title; linkType.value = link.linkType; linkUrl.value = link.url }
function clearLinkForm(): void { editingLinkId.value = null; linkTitle.value = ''; linkType.value = 'official_website'; linkUrl.value = '' }
async function saveLink(): Promise<void> {
  if (!linkTitle.value.trim() || !linkUrl.value.trim() || busy.value) return
  const input: CatalogLinkInput = { title: linkTitle.value.trim(), linkType: linkType.value, url: linkUrl.value.trim() }
  busy.value = true
  try { if (editingLinkId.value) await catalogApi.updateLink(props.catalogKey, editingLinkId.value, input); else await catalogApi.createLink(props.catalogKey, input); clearLinkForm(); await refresh() }
  catch { emit('error', '공개 HTTPS 주소와 링크 입력값을 확인해 주세요.') } finally { busy.value = false }
}
async function removeLink(link: CatalogLinkItem): Promise<void> { if (!confirm(`'${link.title}' 링크를 삭제할까요?`)) return; try { await catalogApi.deleteLink(props.catalogKey, link.id); await refresh() } catch { emit('error', '링크를 삭제하지 못했습니다.') } }
function safeExternalUrl(value: string): string | undefined { try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined } catch { return undefined } }
onMounted(refresh)
</script>

<template>
  <section v-if="mode === 'files'" class="asset-section surface-card">
    <div class="section-heading"><div><h3>참고 파일</h3><p>검증 상태가 clean인 자료만 다운로드할 수 있습니다.</p></div></div>
    <div class="asset-form three-columns"><label>제목<input v-model="fileTitle" maxlength="160" placeholder="RS485 통신 프로토콜"></label><label>문서 유형<select v-model="documentType"><option value="communication_protocol">통신 프로토콜</option><option value="manual">매뉴얼</option><option value="datasheet">데이터시트</option><option value="reference_image">참고 이미지</option><option value="other">기타</option></select></label><label>파일<input type="file" accept=".pdf,.txt,.png,.jpg,.jpeg,.webp,.doc,.docx" @change="chooseFile"></label><button class="button button-primary" type="button" :disabled="busy || !selectedFile || !fileTitle.trim()" @click="uploadFile">파일 등록</button></div>
    <ul v-if="files.length" class="asset-list"><li v-for="file in files" :key="file.id"><div><strong>{{ file.title }}</strong><span>{{ file.originalName }} · {{ Math.ceil(file.byteSize / 1024) }}KB</span></div><span class="status-pill" :class="file.status === 'clean' ? 'success' : 'warning'">{{ file.status }}</span><div class="inline-actions"><button class="button button-ghost button-compact" type="button" :disabled="file.status !== 'clean'" @click="download(file)">다운로드</button><button class="button danger button-compact" type="button" @click="removeFile(file)">삭제</button></div></li></ul><p v-else class="empty-copy">등록된 참고 파일이 없습니다.</p>
  </section>
  <section v-else class="asset-section surface-card">
    <div class="section-heading"><div><h3>참고 링크</h3><p>서버는 주소를 방문하지 않고 HTTPS URL만 보관합니다.</p></div></div>
    <div class="asset-form three-columns"><label>제목<input v-model="linkTitle" maxlength="160" placeholder="제조사 제품 페이지"></label><label>링크 유형<select v-model="linkType"><option value="official_website">공식 홈페이지</option><option value="manufacturer_page">제조사 페이지</option><option value="documentation">문서</option><option value="reference">참고 자료</option><option value="retailer">판매처(쇼핑몰·판매점)</option></select></label><label>HTTPS URL<input v-model="linkUrl" type="url" maxlength="2048" placeholder="https://example.com/products/temp-100"></label><div class="inline-actions"><button class="button button-primary" type="button" :disabled="busy || !linkTitle.trim() || !linkUrl.trim()" @click="saveLink">{{ editingLinkId ? '링크 수정' : '링크 추가' }}</button><button v-if="editingLinkId" class="button button-ghost" type="button" @click="clearLinkForm">취소</button></div></div>
    <ul v-if="links.length" class="asset-list"><li v-for="link in links" :key="link.id"><div><strong>{{ link.title }}</strong><a v-if="safeExternalUrl(link.url)" :href="safeExternalUrl(link.url)" target="_blank" rel="noopener noreferrer">{{ link.url }}</a><span v-else>유효하지 않은 URL</span></div><span class="status-pill muted">{{ link.linkType }}</span><div class="inline-actions"><button class="button button-ghost button-compact" type="button" @click="editLink(link)">수정</button><button class="button danger button-compact" type="button" @click="removeLink(link)">삭제</button></div></li></ul><p v-else class="empty-copy">등록된 참고 링크가 없습니다.</p>
  </section>
</template>
