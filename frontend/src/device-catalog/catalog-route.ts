export type AppRoute =
  | { readonly page: 'dashboard' }
  | { readonly page: 'scan' }
  | { readonly page: 'catalog-list'; readonly search?: string }
  | { readonly page: 'catalog-add'; readonly observedBaudRate?: number; readonly observedSlaveId?: number }
  | { readonly page: 'catalog-ai-add' }
  | { readonly page: 'catalog-ai-edit'; readonly catalogKey: string }
  | { readonly page: 'catalog-view'; readonly catalogKey: string }
  | { readonly page: 'catalog-edit-json'; readonly catalogKey: string }
  | { readonly page: 'catalog-edit-thumbnail'; readonly catalogKey: string }
  | { readonly page: 'catalog-edit-files'; readonly catalogKey: string }
  | { readonly page: 'catalog-edit-links'; readonly catalogKey: string }
  | { readonly page: 'test-device'; readonly name: string; readonly catalogKey: string; readonly catalogRevision: number; readonly baudRate: number; readonly slaveId: number; readonly origin: 'catalog' | 'scan' }
  | { readonly page: 'test-group-list' }
  | { readonly page: 'test-group-add' }
  | { readonly page: 'test-group-edit'; readonly groupId: number }
  | { readonly page: 'test-group-run'; readonly groupId: number }

const CATALOG_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/ // API URL에 허용되는 Catalog key. 예: "cwt-th04s"

/** App shell이 새로고침·뒤로가기를 같은 화면 상태로 복원할 때 현재 URL을 제한된 route로 해석한다. */
export function parseAppRoute(location: Pick<Location, 'pathname' | 'search'> = window.location): AppRoute {
  if (location.pathname === '/test-groups') return { page: 'test-group-list' }
  if (location.pathname === '/test-groups/add') return { page: 'test-group-add' }
  const groupRoute = /^\/test-groups\/(\d+)\/(edit|run)$/.exec(location.pathname)
  if (groupRoute) { const groupId = Number(groupRoute[1]); if (Number.isSafeInteger(groupId) && groupId > 0) return { page: groupRoute[2] === 'edit' ? 'test-group-edit' : 'test-group-run', groupId } }
  if (location.pathname === '/scan') return { page: 'scan' }
  if (location.pathname === '/test-device') {
    const parameters = new URLSearchParams(location.search)
    const name = parameters.get('name')?.trim() ?? ''
    const catalogKey = parameters.get('catalog') ?? ''
    const catalogRevision = Number(parameters.get('revision'))
    const baudRate = Number(parameters.get('baudRate'))
    const slaveId = Number(parameters.get('slaveId'))
    const origin = parameters.get('origin')
    if (name.length >= 1 && name.length <= 100 && CATALOG_KEY_PATTERN.test(catalogKey)
      && Number.isInteger(catalogRevision) && catalogRevision >= 1
      && Number.isInteger(baudRate) && baudRate >= 300 && baudRate <= 4_000_000
      && Number.isInteger(slaveId) && slaveId >= 1 && slaveId <= 247
      && (origin === 'catalog' || origin === 'scan')) {
      return { page: 'test-device', name, catalogKey, catalogRevision, baudRate, slaveId, origin }
    }
    return { page: 'catalog-list' }
  }
  if (location.pathname === '/catalogs/add') {
    const parameters = new URLSearchParams(location.search)
    const observedBaudRate = Number(parameters.get('baudRate'))
    const observedSlaveId = Number(parameters.get('slaveId'))
    const route: AppRoute = { page: 'catalog-add' }
    if (Number.isInteger(observedBaudRate) && observedBaudRate >= 300 && observedBaudRate <= 4_000_000
      && Number.isInteger(observedSlaveId) && observedSlaveId >= 1 && observedSlaveId <= 247) {
      return { ...route, observedBaudRate, observedSlaveId }
    }
    return route
  }
  if (location.pathname === '/catalogs/ai-add') return { page: 'catalog-ai-add' }
  if (location.pathname === '/catalogs/ai-edit') {
    const catalogKey = new URLSearchParams(location.search).get('id') ?? ''
    return CATALOG_KEY_PATTERN.test(catalogKey) ? { page: 'catalog-ai-edit', catalogKey } : { page: 'catalog-list' }
  }
  const editPageByPath = { // 수정 책임별 URL을 화면 상태로 변환한다. 예: "/catalogs/edit/files"
    '/catalogs/edit': 'catalog-edit-json',
    '/catalogs/edit/json': 'catalog-edit-json',
    '/catalogs/edit/thumbnail': 'catalog-edit-thumbnail',
    '/catalogs/edit/files': 'catalog-edit-files',
    '/catalogs/edit/links': 'catalog-edit-links',
  } as const
  if (location.pathname === '/catalogs/view' || location.pathname in editPageByPath) {
    const catalogKey = new URLSearchParams(location.search).get('id') ?? ''
    if (CATALOG_KEY_PATTERN.test(catalogKey)) {
      if (location.pathname === '/catalogs/view') return { page: 'catalog-view', catalogKey }
      return { page: editPageByPath[location.pathname as keyof typeof editPageByPath], catalogKey }
    }
    return { page: 'catalog-list' }
  }
  if (location.pathname === '/catalogs') {
    const rawSearch = new URLSearchParams(location.search).get('search')?.trim() ?? ''
    return rawSearch.length <= 100 && rawSearch ? { page: 'catalog-list', search: rawSearch } : { page: 'catalog-list' }
  }
  return { page: 'dashboard' }
}

/** 화면 버튼에서 호출해 주소와 Vue 화면 상태를 함께 변경한다. 외부 URL은 받지 않는다. */
export function routeUrl(route: AppRoute): string {
  if (route.page === 'dashboard') return '/'
  if (route.page === 'scan') return '/scan'
  if (route.page === 'test-group-list') return '/test-groups'
  if (route.page === 'test-group-add') return '/test-groups/add'
  if (route.page === 'test-group-edit') return `/test-groups/${route.groupId}/edit`
  if (route.page === 'test-group-run') return `/test-groups/${route.groupId}/run`
  if (route.page === 'catalog-list') return route.search?.trim() ? `/catalogs?search=${encodeURIComponent(route.search.trim())}` : '/catalogs'
  if (route.page === 'catalog-add') {
    if (route.observedBaudRate && route.observedSlaveId) return `/catalogs/add?baudRate=${route.observedBaudRate}&slaveId=${route.observedSlaveId}`
    return '/catalogs/add'
  }
  if (route.page === 'catalog-ai-add') return '/catalogs/ai-add'
  if (route.page === 'catalog-ai-edit') return `/catalogs/ai-edit?id=${encodeURIComponent(route.catalogKey)}`
  if (route.page === 'test-device') {
    const parameters = new URLSearchParams({
      name: route.name, catalog: route.catalogKey, revision: String(route.catalogRevision),
      baudRate: String(route.baudRate), slaveId: String(route.slaveId), origin: route.origin,
    })
    return `/test-device?${parameters}`
  }
  if (route.page === 'catalog-view') return `/catalogs/view?id=${encodeURIComponent(route.catalogKey)}`
  const editPath = route.page.replace('catalog-edit-', '')
  return `/catalogs/edit/${editPath}?id=${encodeURIComponent(route.catalogKey)}`
}
