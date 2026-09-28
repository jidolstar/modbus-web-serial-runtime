<script setup lang="ts">
import { onMounted, ref } from 'vue'
import type { AppRoute } from '../device-catalog/catalog-route'
import { testGroupApi, type TestGroup } from '../test-groups/test-group-api'
const emit = defineEmits<{ navigate: [route: AppRoute] }>()
const groups = ref<readonly TestGroup[]>([]); const error = ref<string | null>(null); const loading = ref(true)
async function load(): Promise<void> { loading.value = true; try { groups.value = await testGroupApi.list() } catch { error.value = '테스트 그룹을 불러오지 못했습니다.' } finally { loading.value = false } }
async function remove(group: TestGroup): Promise<void> { if (!window.confirm(`“${group.name}” 그룹과 ${group.nodes.length}개 node를 삭제할까요?`)) return; await testGroupApi.delete(group.id); await load() }
onMounted(load)
</script>
<template>
  <header class="page-heading detail-page-heading"><div><p class="eyebrow">TEST GROUPS</p><h1>테스트 그룹</h1><p class="description">같은 RS485 버스에서 순서대로 측정할 장비를 저장합니다.</p></div><div class="page-heading-actions"><button class="button button-primary" type="button" @click="emit('navigate', { page: 'test-group-add' })">새 그룹</button></div></header>
  <p v-if="error" class="notice error">{{ error }}</p><p v-else-if="loading" class="empty-panel surface-card">불러오는 중입니다.</p>
  <section v-else-if="groups.length" class="catalog-grid"><article v-for="group in groups" :key="group.id" class="test-group-list-row"><div><h2>{{ group.name }}</h2><p>{{ group.nodes.length }}개 node · {{ group.serialConfig.baudRate.toLocaleString() }} baud · revision {{ group.revision }}</p></div><div class="inline-actions"><button class="button button-primary button-small" type="button" @click="emit('navigate', { page: 'test-group-run', groupId: group.id })">실행</button><button class="button button-ghost button-small" type="button" @click="emit('navigate', { page: 'test-group-edit', groupId: group.id })">수정</button><button class="button danger button-small" type="button" @click="remove(group)">삭제</button></div></article></section>
  <section v-else class="empty-panel surface-card"><p>저장된 테스트 그룹이 없습니다.</p><button class="button button-primary" type="button" @click="emit('navigate', { page: 'test-group-add' })">첫 그룹 만들기</button></section>
</template>
