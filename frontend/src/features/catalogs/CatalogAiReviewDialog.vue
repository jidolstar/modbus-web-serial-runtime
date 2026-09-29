<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import type { CatalogAiProposal } from '@modbus-manager/device-catalog-domain'
import type { CatalogAiFile } from '../../device-catalog/catalog-ai-api'
import type { CatalogAiRevisionSummary } from '../../device-catalog/catalog-ai-revision'
import FileDropField from '../../components/FileDropField.vue'

const props = defineProps<{
  readonly proposal: CatalogAiProposal
  readonly files: readonly CatalogAiFile[]
  readonly approving: boolean
  readonly revision: number
  readonly history: readonly CatalogAiRevisionSummary[]
  readonly editMode?: boolean
}>()
const emit = defineEmits<{
  approve: [fileIds: readonly string[], urls: readonly string[]]
  review: [instruction: string, urls: readonly string[], files: readonly File[]]
  cancel: []
}>()

// 선택 상태는 승인 때 영구 Catalog asset으로 승격할 자료만 부모에게 전달하기 위한 modal 내부 상태다.
const dialog = ref<HTMLDialogElement | null>(null)
const reviewInstruction = ref('')
const reviewUrls = ref('')
const reviewFiles = ref<File[]>([])
const selectedFiles = ref(new Set(props.files.map(({ id }) => id)))
const selectedUrls = ref(new Set(props.proposal.sources.map(({ url }) => url)))
const json = computed(() => JSON.stringify(props.proposal.definition, null, 2))

onMounted(() => dialog.value?.showModal())
// 부모가 proposal을 비워 component를 제거할 때 browser top layer에서도 즉시 dialog를 해제한다.
onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})

function toggle(set: Set<string>, value: string, checked: boolean): void {
  if (checked) set.add(value)
  else set.delete(value)
}

/** 재검토 모달의 파일 선택·drop이 호출하며 중복을 제외하고 한 요청당 최대 5개만 유지한다. */
function chooseReviewFiles(files: readonly File[]): void {
  const existing = new Set(reviewFiles.value.map((file) => `${file.name}:${file.size}:${file.lastModified}`))
  const merged = [...reviewFiles.value]
  for (const file of files) {
    const identity = `${file.name}:${file.size}:${file.lastModified}`
    if (!existing.has(identity) && merged.length < 5) {
      existing.add(identity)
      merged.push(file)
    }
  }
  reviewFiles.value = merged
}

function removeReviewFile(index: number): void {
  reviewFiles.value = reviewFiles.value.filter((_, current) => current !== index)
}

/** 재검토 버튼이 호출하며 새 자료만 부모에 전달한다. 기존 proposal과 session 자료 결합은 작성 화면이 담당한다. */
function submitReview(): void {
  const urls = reviewUrls.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
  emit('review', reviewInstruction.value.trim(), urls, reviewFiles.value)
}

/** 검증 실패 CTA가 호출하며 서버 설명을 별도 입력 없이 재검토 지시로 전달한다. 자동 재요청은 하지 않는다. */
function submitValidationReview(): void {
  const details = props.proposal.validation.issues.map(({ path, message }) => `- ${path}: ${message}`).join('\n')
  emit('review', `아래 서버 검증 오류를 모두 수정하고 전체 CatalogBundle 계약을 다시 확인해 주세요.\n${details}`, [], [])
}
</script>

<template>
  <dialog ref="dialog" class="ai-review-dialog" @cancel.prevent="emit('cancel')">
    <article class="ai-review-card">
      <header>
        <div>
          <p class="eyebrow">AI CATALOG REVIEW · REVISION {{ revision }}</p>
          <h2>{{ proposal.title }}</h2>
        </div>
        <button class="dialog-close" type="button" aria-label="작성 취소 확인" @click="emit('cancel')">×</button>
      </header>
      <section v-if="!proposal.validation.valid" class="ai-validation-panel" aria-labelledby="ai-validation-title">
        <h3 id="ai-validation-title">서버 검증을 통과하지 못했습니다</h3>
        <p>아래 항목을 확인하거나 서버 검증 결과를 AI에 전달해 다시 작성할 수 있습니다.</p>
        <ul>
          <li v-for="issue in proposal.validation.issues" :key="`${issue.path}-${issue.message}`">
            <code>{{ issue.path }}</code>
            <span>{{ issue.message }}</span>
          </li>
        </ul>
        <button class="button button-secondary button-small" type="button" :disabled="approving" @click="submitValidationReview">검증 오류 반영해 재검토</button>
      </section>
      <section v-if="proposal.warnings.length">
        <h3>경고</h3>
        <ul><li v-for="warning in proposal.warnings" :key="warning">{{ warning }}</li></ul>
      </section>
      <section v-if="proposal.assumptions.length">
        <h3>가정</h3>
        <ul><li v-for="assumption in proposal.assumptions" :key="assumption">{{ assumption }}</li></ul>
      </section>
      <section class="ai-revision-history" aria-labelledby="ai-revision-history-title">
        <h3 id="ai-revision-history-title">생성 이력</h3>
        <ol>
          <li v-for="item in history" :key="item.revision">
            <div>
              <strong>Revision {{ item.revision }}</strong>
              <span :class="['status-pill', item.valid ? 'success' : 'error']">{{ item.valid ? '검증 통과' : '검증 실패' }}</span>
            </div>
            <p>{{ item.instruction }}</p>
            <small>{{ item.title }} · 경고 {{ item.warningCount }}개</small>
          </li>
        </ol>
      </section>
      <section>
        <h3>생성된 CatalogBundle JSON</h3>
        <pre class="json-viewer">{{ json }}</pre>
      </section>
      <section v-if="files.length && !editMode" class="ai-source-list">
        <h3>Catalog에 보관할 첨부 문서</h3>
        <label v-for="file in files" :key="file.id">
          <input type="checkbox" :checked="selectedFiles.has(file.id)" @change="toggle(selectedFiles, file.id, ($event.target as HTMLInputElement).checked)">
          {{ file.name }} · {{ Math.ceil(file.sizeBytes / 1024) }}KB
        </label>
      </section>
      <section v-if="proposal.sources.length && !editMode" class="ai-source-list">
        <h3>Catalog에 보관할 참고 링크</h3>
        <label v-for="source in proposal.sources" :key="source.url">
          <input type="checkbox" :checked="selectedUrls.has(source.url)" @change="toggle(selectedUrls, source.url, ($event.target as HTMLInputElement).checked)">
          {{ source.title }} · {{ source.url }}
        </label>
      </section>
      <section class="ai-review-request">
        <label for="ai-review-instruction">재검토 요청</label>
        <textarea id="ai-review-instruction" v-model="reviewInstruction" maxlength="5000" placeholder="부족한 점이나 수정할 내용을 입력하세요."></textarea>
        <label for="ai-review-urls">추가 참고 URL <small>한 줄에 하나씩 입력합니다.</small></label>
        <textarea id="ai-review-urls" v-model="reviewUrls" rows="3" placeholder="https://example.com/manual"></textarea>
        <label for="ai-review-files">추가 문서·이미지</label>
        <FileDropField
          id="ai-review-files"
          multiple
          accept=".pdf,.txt,.md,.json,.doc,.docx,.png,.jpg,.jpeg,.webp"
          :disabled="approving"
          prompt="추가 문서나 이미지를 이 영역에 끌어놓거나 파일 선택 버튼을 눌러 주세요."
          @files="chooseReviewFiles"
        />
        <ul v-if="reviewFiles.length" class="ai-file-list">
          <li v-for="(file, index) in reviewFiles" :key="`${file.name}-${file.size}`">
            <span>{{ file.name }} · {{ Math.ceil(file.size / 1024) }}KB</span>
            <button type="button" aria-label="추가 파일 제거" @click="removeReviewFile(index)">제거</button>
          </li>
        </ul>
      </section>
      <footer>
        <button class="button button-ghost" type="button" :disabled="approving" @click="emit('cancel')">작성 취소</button>
        <button class="button button-secondary" type="button" :disabled="approving || !reviewInstruction.trim()" @click="submitReview">재검토</button>
        <button class="button button-primary" type="button" :disabled="approving || !proposal.validation.valid" @click="emit('approve', [...selectedFiles], [...selectedUrls])">{{ approving ? (editMode ? '적용 중…' : '등록 중…') : (editMode ? 'AI 수정안 적용' : '승인 및 등록') }}</button>
      </footer>
    </article>
  </dialog>
</template>
