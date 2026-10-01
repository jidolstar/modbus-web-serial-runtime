<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref } from 'vue'
import type { CatalogAiInsufficientEvidence, CatalogAiMissingEvidence } from '../../device-catalog/catalog-ai-api'

defineProps<{ readonly result: CatalogAiInsufficientEvidence }>()
const emit = defineEmits<{ confirm: [] }>()
const dialog = ref<HTMLDialogElement | null>(null)

const evidenceLabels: Readonly<Record<CatalogAiMissingEvidence, string>> = {
  modbusProtocol: '제공한 자료에서 Modbus 통신 정보를 확인하기 어렵습니다.',
  readableMeasurement: '안전하게 실행할 데이터 읽기 항목을 구성할 자료가 부족합니다.',
  requestedChange: '요청한 변경을 뒷받침하는 장비 자료가 부족합니다.',
}

// Esc와 확인은 모두 자료를 폐기하지 않고 부모의 요청 화면으로 돌아간다.
onMounted(() => dialog.value?.showModal())
onBeforeUnmount(() => {
  if (dialog.value?.open) dialog.value.close()
})
</script>

<template>
  <dialog ref="dialog" class="ai-review-dialog ai-cancel-dialog" role="alertdialog" aria-labelledby="ai-insufficient-title" aria-describedby="ai-insufficient-description" @cancel.prevent="emit('confirm')">
    <article class="ai-review-card">
      <header>
        <div>
          <p class="eyebrow">MORE DEVICE DATA REQUIRED</p>
          <h2 id="ai-insufficient-title">JSON을 만들 수 없습니다</h2>
        </div>
      </header>
      <p id="ai-insufficient-description">추측한 register 정보로 Catalog를 만들지 않았습니다. 아래 내용을 확인하고 자료를 보완해 주세요.</p>
      <ul>
        <li v-for="item in result.missingEvidence" :key="item">{{ evidenceLabels[item] }}</li>
      </ul>
      <section>
        <h3>확인된 부족 사유</h3>
        <ul><li v-for="reason in result.reasons" :key="reason">{{ reason }}</li></ul>
      </section>
      <p class="description">Modbus 통신 정보와 최소 1개의 데이터 읽기 항목에 필요한 주소, 데이터 형식과 배율이 포함된 자료를 추가해 주세요.</p>
      <footer>
        <button class="button button-primary" type="button" @click="emit('confirm')">확인</button>
      </footer>
    </article>
  </dialog>
</template>
