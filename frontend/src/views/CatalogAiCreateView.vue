<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { AppRoute } from '../device-catalog/catalog-route'
import { catalogApi, CatalogApiError } from '../device-catalog/catalog-api'
import FileDropField from '../components/FileDropField.vue'
import CatalogAiReviewDialog from '../features/catalogs/CatalogAiReviewDialog.vue'
import CatalogAiCancelDialog from '../features/catalogs/CatalogAiCancelDialog.vue'
import { catalogAiApi, type CatalogAiFile, type CatalogAiProposal } from '../device-catalog/catalog-ai-api'
import { appendCatalogAiRevision, type CatalogAiRevisionSummary } from '../device-catalog/catalog-ai-revision'

type CatalogAiPhase = 'editing' | 'uploading' | 'queued' | 'generating' | 'validating' | 'reviewing' | 'approving'

const emit = defineEmits<{ navigate: [route: AppRoute] }>()
const props = defineProps<{
  readonly mode: 'create' | 'edit' // Dashboard route가 화면 목적을 명시해 선택적 key 유무로 작성·수정을 추론하지 않는다.
  readonly catalogKey?: string
}>()

// 이 component가 페이지를 떠날 때까지 입력, 최신 proposal과 재검토 이력을 소유한다. 서버에는 임시 파일과 job만 보관한다.
const requirements = ref('')
const urlsText = ref('')
const pendingFiles = ref<File[]>([])
const uploadedFiles = ref<CatalogAiFile[]>([])
const sessionId = ref<string>()
const jobId = ref<string>()
const proposal = ref<CatalogAiProposal>()
const proposalDigest = ref<string>()
const revisionHistory = ref<readonly CatalogAiRevisionSummary[]>([])
const phase = ref<CatalogAiPhase>('editing')
const notice = ref<string>()
const baseRevision = ref<number>()
const catalogTitle = ref('')
const thumbnailPreviewUrl = ref<string>()
const isEdit = computed(() => props.mode === 'edit')
const initializing = ref(isEdit.value)

// generationToken은 이전 polling loop가 새 요청이나 취소 이후의 화면 상태를 덮어쓰지 못하게 한다.
let generationToken = 0
let suspendedProposal: { proposal?: CatalogAiProposal; digest?: string } | undefined
let timer: number | undefined
const startedAt = ref<number>()
const elapsedSeconds = ref(0)
const confirmingDiscard = ref(false)
const discarding = ref(false)

const busy = computed(() => ['uploading', 'queued', 'generating', 'validating', 'approving'].includes(phase.value))
const revision = computed(() => revisionHistory.value.length)
const urls = computed(() => urlsText.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))
const hasGenerationSource = computed(() => isEdit.value
  ? Boolean(requirements.value.trim())
  : Boolean(requirements.value.trim() || urls.value.length || pendingFiles.value.length || uploadedFiles.value.length))

/** AI 수정 진입 때 현재 링크·clean 파일·제품 이미지를 기존 Catalog API로 읽어 최초 참고 자료에 채운다. */
async function loadEditSources(): Promise<void> {
  if (!isEdit.value) return
  if (!props.catalogKey) {
    notice.value = '수정할 카탈로그 제품 키가 없습니다.'
    initializing.value = false
    return
  }
  try {
    const [detail, files, links, thumbnail] = await Promise.all([
      catalogApi.get(props.catalogKey), catalogApi.listFiles(props.catalogKey), catalogApi.listLinks(props.catalogKey), catalogApi.getThumbnailBlob(props.catalogKey),
    ])
    baseRevision.value = detail.revision
    catalogTitle.value = detail.title
    urlsText.value = links.map(({ url }) => url).slice(0, 10).join('\n')
    const sourceFiles: File[] = []
    let sourceBytes = 0
    if (thumbnail) {
      thumbnailPreviewUrl.value = URL.createObjectURL(thumbnail)
      sourceFiles.push(new File([thumbnail], 'product-thumbnail.jpg', { type: thumbnail.type || 'image/jpeg' }))
      sourceBytes += thumbnail.size
    }
    for (const file of files.filter(({ status }) => status === 'clean')) {
      if (sourceFiles.length >= 5 || sourceBytes + file.byteSize > 20 * 1024 * 1024) break
      const blob = await catalogApi.downloadFile(props.catalogKey, file)
      sourceFiles.push(new File([blob], file.originalName, { type: file.contentType }))
      sourceBytes += blob.size
    }
    pendingFiles.value = sourceFiles
    if (files.filter(({ status }) => status === 'clean').length > sourceFiles.length - (thumbnail ? 1 : 0) || links.length > 10) {
      notice.value = 'AI 입력 제한에 맞춰 최근 참고 파일과 URL만 포함했습니다. 필요한 자료는 수정 지시와 함께 추가해 주세요.'
    }
  } catch (error) {
    notice.value = error instanceof CatalogApiError && error.status === 404 ? '수정할 카탈로그를 찾을 수 없습니다.' : '기존 카탈로그 자료를 불러오지 못했습니다.'
  } finally {
    initializing.value = false
  }
}

function chooseFiles(files: readonly File[]): void {
  const existing = new Set(pendingFiles.value.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
  const merged = [...pendingFiles.value]
  for (const file of files) {
    const identity = `${file.name}:${file.size}:${file.lastModified}`
    if (!existing.has(identity)) {
      existing.add(identity)
      merged.push(file)
    }
  }
  if (merged.length > 5) notice.value = '문서·이미지는 최대 5개까지 첨부할 수 있습니다.'
  pendingFiles.value = merged.slice(0, 5)
}

function removePendingFile(index: number): void {
  pendingFiles.value = pendingFiles.value.filter((_, current) => current !== index)
}

/** Backend의 안정 오류 code만 사용자 문구로 바꾸며 upstream 원문이나 내부 설정은 화면에 노출하지 않는다. */
function message(error: unknown): string {
  if (error instanceof CatalogApiError && error.code === 'CATALOG_AI_NOT_CONFIGURED') {
    return 'Gemini API 설정을 사용할 수 없습니다.'
  }
  if (error instanceof CatalogApiError && error.code === 'CATALOG_AI_ACCESS_DENIED') {
    return 'Gemini API key 또는 선택한 모델의 요청 권한이 없습니다.'
  }
  if (error instanceof CatalogApiError && error.code === 'CATALOG_AI_MODEL_UNAVAILABLE') {
    return '설정한 Gemini 모델을 이 API 프로젝트에서 사용할 수 없습니다.'
  }
  if (error instanceof CatalogApiError && error.code === 'CATALOG_AI_UPSTREAM_UNAVAILABLE') {
    return 'Gemini 모델이 현재 혼잡합니다. 잠시 후 다시 시도해 주세요. 입력한 내용은 그대로 유지됩니다.'
  }
  if (error instanceof CatalogApiError && error.code === 'CATALOG_FILE_TYPE_REJECTED') {
    return '지원하지 않거나 안전 검사를 통과하지 못한 파일입니다.'
  }
  if (error instanceof CatalogApiError && error.code === 'CATALOG_REVISION_CONFLICT') {
    return '다른 곳에서 먼저 수정했습니다. 현재 수정안은 유지되지만 최신 상세를 확인한 뒤 다시 시작해 주세요.'
  }
  return 'AI 카탈로그 요청을 처리하지 못했습니다. 입력을 유지했으니 다시 시도해 주세요.'
}

function startElapsed(): void {
  startedAt.value = Date.now()
  elapsedSeconds.value = 0
  if (timer) clearInterval(timer)
  timer = window.setInterval(() => {
    elapsedSeconds.value = Math.floor((Date.now() - (startedAt.value ?? Date.now())) / 1_000)
  }, 1_000)
}

function stopElapsed(): void {
  if (timer) clearInterval(timer)
  timer = undefined
}

/**
 * 최초 생성과 검토 모달의 재검토 요청이 호출하며, 하나의 server job을 완료 상태까지 polling한다.
 * 재검토가 실패하면 사용자가 다시 시도할 수 있도록 이전 proposal과 이력을 복원한다.
 */
async function generate(
  revisionInstruction?: string,
  additionalUrls: readonly string[] = [],
  additionalFiles: readonly File[] = [],
): Promise<void> {
  const previousProposal = proposal.value
  const previousDigest = proposalDigest.value
  const isReview = Boolean(revisionInstruction)
  const currentToken = ++generationToken

  notice.value = undefined
  suspendedProposal = { proposal: previousProposal, digest: previousDigest }
  proposal.value = undefined
  proposalDigest.value = undefined
  phase.value = 'uploading'
  startElapsed()

  try {
    const mergedUrls = [...new Set([...urls.value, ...additionalUrls])]
    const accepted = isEdit.value && props.catalogKey
      ? await catalogAiApi.createEditJob(props.catalogKey, {
        revisionInstruction: revisionInstruction?.trim() || requirements.value.trim(),
        referenceUrls: mergedUrls,
        files: [...pendingFiles.value, ...additionalFiles],
        sessionId: sessionId.value,
        previousProposal: isReview ? previousProposal : undefined,
      })
      : await catalogAiApi.createJob({
      requirements: requirements.value.trim(),
      referenceUrls: mergedUrls,
      files: [...pendingFiles.value, ...additionalFiles],
      sessionId: sessionId.value,
      revisionInstruction,
      previousProposal: isReview ? previousProposal : undefined,
      })

    if (additionalUrls.length > 0) urlsText.value = mergedUrls.join('\n')
    sessionId.value = accepted.sessionId
    jobId.value = accepted.jobId
    uploadedFiles.value = [...accepted.files]
    pendingFiles.value = []
    phase.value = 'queued'

    while (currentToken === generationToken) {
      await new Promise((resolve) => setTimeout(resolve, phase.value === 'queued' ? 1_000 : 2_000))
      const state = await catalogAiApi.getJob(accepted.jobId)
      if (state.status === 'queued' || state.status === 'generating' || state.status === 'validating') {
        phase.value = state.status
        continue
      }
      if (state.status === 'completed' && state.proposal && state.proposalDigest) {
        proposal.value = state.proposal
        proposalDigest.value = state.proposalDigest
        revisionHistory.value = appendCatalogAiRevision(revisionHistory.value, revisionInstruction, state.proposal)
        suspendedProposal = undefined
        phase.value = 'reviewing'
        stopElapsed()
        return
      }
      throw new CatalogApiError(502, state.errorCode ?? 'CATALOG_AI_UPSTREAM_FAILED')
    }
  } catch (error) {
    if (currentToken !== generationToken) return
    // 최초 생성 실패에는 돌아갈 결과가 없지만 재검토 실패에는 직전 검토 결과를 다시 연다.
    proposal.value = previousProposal
    proposalDigest.value = previousDigest
    suspendedProposal = undefined
    phase.value = previousProposal ? 'reviewing' : 'editing'
    stopElapsed()
    notice.value = message(error)
  }
}

/** 생성 중 취소 버튼이 호출하며 현재 job만 중단한다. 입력과 이미 완성된 재검토 이력은 유지한다. */
async function cancelJob(): Promise<void> {
  generationToken += 1
  if (jobId.value) await catalogAiApi.cancel(jobId.value).catch(() => undefined)
  proposal.value = suspendedProposal?.proposal
  proposalDigest.value = suspendedProposal?.digest
  suspendedProposal = undefined
  phase.value = proposal.value ? 'reviewing' : 'editing'
  stopElapsed()
}

/** 검토 모달의 승인 버튼이 호출하며 서버가 digest와 소유권을 재검증한 뒤 등록한 Catalog로 이동한다. */
async function approve(fileIds: readonly string[], retainedUrls: readonly string[]): Promise<void> {
  if (!sessionId.value || !jobId.value || !proposalDigest.value) return

  phase.value = 'approving'
  notice.value = undefined
  try {
    const created = isEdit.value && props.catalogKey && baseRevision.value
      ? await catalogAiApi.approveEdit(props.catalogKey, sessionId.value, { jobId: jobId.value, proposalDigest: proposalDigest.value, baseRevision: baseRevision.value })
      : await catalogAiApi.approve(sessionId.value, { jobId: jobId.value, proposalDigest: proposalDigest.value, retainedFileIds: fileIds, retainedUrls })
    // 승인 service가 session을 이미 폐기하므로 unmount의 best-effort DELETE가 중복 호출되지 않게 한다.
    sessionId.value = undefined
    jobId.value = undefined
    emit('navigate', { page: 'catalog-view', catalogKey: created.catalogKey })
  } catch (error) {
    phase.value = 'reviewing'
    notice.value = message(error)
  }
}

function requestReview(instruction: string, additionalUrls: readonly string[], additionalFiles: readonly File[]): void {
  void generate(instruction, additionalUrls, additionalFiles)
}

/** 목록 이동과 검토 모달 닫기가 같은 확인 절차를 사용하도록 취소 확인 dialog를 연다. */
function requestDiscard(): void {
  confirmingDiscard.value = true
}

function clearDraftState(): void {
  // route 전환이 Serial 정리를 기다리는 동안에도 두 dialog와 경과 시간 표시가 화면에 남지 않게 먼저 닫는다.
  confirmingDiscard.value = false
  phase.value = 'editing'
  stopElapsed()
  startedAt.value = undefined
  elapsedSeconds.value = 0
  requirements.value = ''
  urlsText.value = ''
  pendingFiles.value = []
  uploadedFiles.value = []
  proposal.value = undefined
  proposalDigest.value = undefined
  suspendedProposal = undefined
  revisionHistory.value = []
  sessionId.value = undefined
  jobId.value = undefined
}

/**
 * 상단 목록 이동에서 호출한다. 서버 session이 생기기 전의 입력만 있다면 정리할 자원이 없어 바로 이동한다.
 * session 또는 생성 결과가 있으면 실수로 Gemini 파일과 검토 결과를 버리지 않도록 확인 dialog를 연다.
 */
function leaveForCatalogList(): void {
  if (!sessionId.value && !proposal.value && !busy.value) {
    clearDraftState()
    emit('navigate', props.catalogKey ? { page: 'catalog-view', catalogKey: props.catalogKey } : { page: 'catalog-list' })
    return
  }
  requestDiscard()
}

/**
 * 사용자가 취소를 확정하면 job, local 임시 파일과 Gemini 파일을 정리한 뒤 목록으로 이동한다.
 * session 정리에 실패하면 감사 DB는 건드리지 않고 현재 입력과 화면을 유지해 재시도할 수 있게 한다.
 */
async function discardDraft(): Promise<void> {
  discarding.value = true
  notice.value = undefined
  generationToken += 1
  try {
    if (jobId.value && busy.value) await catalogAiApi.cancel(jobId.value).catch(() => undefined)
    if (sessionId.value) await catalogAiApi.discardSession(sessionId.value)
    // 서버 자원 정리가 끝난 시점에 modal을 먼저 제거하고, 그 다음 비동기 상위 navigation을 요청한다.
    clearDraftState()
    emit('navigate', props.catalogKey ? { page: 'catalog-view', catalogKey: props.catalogKey } : { page: 'catalog-list' })
  } catch (error) {
    confirmingDiscard.value = false
    proposal.value = suspendedProposal?.proposal ?? proposal.value
    proposalDigest.value = suspendedProposal?.digest ?? proposalDigest.value
    suspendedProposal = undefined
    phase.value = proposal.value ? 'reviewing' : 'editing'
    notice.value = message(error)
  } finally {
    discarding.value = false
  }
}

/**
 * sidebar 등 외부 navigation으로 component가 사라질 때 서버 자원을 best-effort로 정리한다.
 * 브라우저 강제 종료는 요청 완료를 보장하지 않으므로 Backend TTL이 최종 안전망이다.
 */
onBeforeUnmount(() => {
  generationToken += 1
  stopElapsed()
  if (jobId.value && busy.value) void catalogAiApi.cancel(jobId.value).catch(() => undefined)
  if (sessionId.value) void catalogAiApi.discardSession(sessionId.value).catch(() => undefined)
  if (thumbnailPreviewUrl.value) URL.revokeObjectURL(thumbnailPreviewUrl.value)
})
onMounted(loadEditSources)
</script>

<template>
  <button class="text-link" type="button" @click="leaveForCatalogList">← {{ isEdit ? '상세로' : '목록으로' }}</button>
  <header class="page-heading">
    <div>
      <p class="eyebrow">{{ isEdit ? 'AI CATALOG EDITOR' : 'AI CATALOG BUILDER' }}</p>
      <h1>{{ isEdit ? 'AI로 카탈로그 수정' : 'AI로 카탈로그 작성' }}</h1>
      <p class="description">{{ isEdit ? `${catalogTitle || props.catalogKey}의 기존 JSON과 등록 자료를 바탕으로 수정안을 만들고 검토 후 적용합니다.` : '공식 자료와 선택 설명을 바탕으로 CatalogBundle JSON 초안을 만들고 검토 후 등록합니다.' }}</p>
    </div>
  </header>
  <div v-if="notice" class="notice error">{{ notice }}</div>
  <p v-if="initializing" class="empty-panel surface-card">기존 카탈로그 자료를 불러오는 중입니다.</p>
  <section v-else class="surface-card ai-catalog-form">
    <div v-if="isEdit" class="readonly-product-key">
      <span>제품 키</span>
      <strong>{{ props.catalogKey }}</strong>
      <small>제품 키는 변경할 수 없습니다.</small>
    </div>
    <div class="ai-source-layout" :class="{ 'with-thumbnail': isEdit && thumbnailPreviewUrl }">
      <div class="ai-source-upload">
        <div class="ai-form-field">
          <strong>문서·이미지</strong>
          <small>PDF, TXT, MD, JSON, DOC/DOCX, PNG, JPEG, WebP · 최대 5개/총 20MB</small>
          <FileDropField
            id="catalog-ai-source-files"
            multiple
            accept=".pdf,.txt,.md,.json,.doc,.docx,.png,.jpg,.jpeg,.webp"
            :disabled="busy"
            prompt="문서나 이미지를 이 영역에 끌어놓거나 파일 선택 버튼을 눌러 주세요."
            @files="chooseFiles"
          />
        </div>
        <ul v-if="pendingFiles.length" class="ai-file-list">
          <li v-for="(file, index) in pendingFiles" :key="`${file.name}-${file.size}`">
            <span>{{ file.name }} · {{ Math.ceil(file.size / 1024) }}KB</span>
            <button type="button" aria-label="선택 파일 제거" @click="removePendingFile(index)">제거</button>
          </li>
        </ul>
      </div>
      <figure v-if="isEdit && thumbnailPreviewUrl" class="ai-thumbnail-preview">
        <figcaption>현재 제품 썸네일</figcaption>
        <img :src="thumbnailPreviewUrl" :alt="`${catalogTitle} 제품 썸네일`">
      </figure>
    </div>
    <label>참고 URL <small>한 줄에 하나씩 public HTTPS 주소를 입력하세요.</small><textarea v-model="urlsText" maxlength="21000" rows="4" placeholder="https://example.com/manual"></textarea></label>
    <label>{{ isEdit ? '무엇을 수정하기 원하는지' : '추가 설명' }} <small>{{ isEdit ? '필수 사항입니다. 변경할 내용을 구체적으로 입력하세요.' : '선택 사항입니다. 자료만으로 부족한 제조사·모델·필요 기능을 보완하세요.' }}</small><textarea v-model="requirements" :maxlength="isEdit ? 5000 : 10000" rows="6" :required="isEdit" :placeholder="isEdit ? '예: 측정값 표시를 소수점 한 자리로 변경해 주세요.' : '자료에 없거나 특별히 반영해야 할 내용을 입력하세요.'"></textarea></label>
    <div v-if="busy" class="ai-progress" role="status" aria-live="polite">
      <strong>{{ phase === 'uploading' ? '자료 업로드 중' : phase === 'queued' ? 'AI 대기 중' : phase === 'generating' ? 'JSON 생성 중' : phase === 'validating' ? '서버 검증 중' : '등록 중' }}</strong>
      <span>{{ elapsedSeconds }}초 경과 · 수십 초에서 수분이 걸릴 수 있습니다.</span>
    </div>
    <div class="inline-actions">
      <button class="button button-primary" type="button" :disabled="busy || !hasGenerationSource" @click="generate()">{{ isEdit ? 'AI 수정안 생성' : 'JSON 생성' }}</button>
      <button v-if="busy && phase !== 'approving'" class="button button-ghost" type="button" @click="cancelJob">취소</button>
    </div>
  </section>
  <CatalogAiReviewDialog
    v-if="proposal"
    :proposal="proposal"
    :files="uploadedFiles"
    :approving="phase === 'approving'"
    :revision="revision"
    :history="revisionHistory"
    :edit-mode="isEdit"
    @approve="approve"
    @review="requestReview"
    @cancel="requestDiscard"
  />
  <CatalogAiCancelDialog
    v-if="confirmingDiscard"
    :discarding="discarding"
    @continue="confirmingDiscard = false"
    @discard="discardDraft"
  />
</template>
