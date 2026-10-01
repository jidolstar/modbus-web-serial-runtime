export type AppRoute =
  | { readonly page: 'dashboard' }
  | { readonly page: 'scan' }
  | { readonly page: 'catalog-list'; readonly search?: string; readonly listPage?: number }
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

export interface RoutePresentation {
  readonly title: string // 상단바의 현재 화면명. 예: "테스트 그룹 실행"
  readonly context: string // 화면이 속한 업무 영역. 예: "장비 운영"
  readonly showBack: boolean // true이면 Shell이 안전한 이전 화면 버튼을 표시한다.
  readonly fallbackRoute?: AppRoute // 직접 URL 진입처럼 앱 내부 이전 이력이 없을 때 이동할 상위 화면이다.
}

export interface AppHistoryState {
  readonly owner: 'modbus-manager' // 다른 script가 기록한 history.state와 앱 이력을 구분하는 고정값이다.
  readonly depth: number // 현재 탭에서 앱이 push한 깊이. 0이면 이전 앱 화면을 보장할 수 없다.
}

const HISTORY_OWNER = 'modbus-manager'

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
    const parameters = new URLSearchParams(location.search)
    const rawSearch = parameters.get('search')?.trim() ?? ''
    const rawPage = parameters.get('page')
    const listPage = rawPage === null ? 1 : Number(rawPage)
    if (rawSearch.length > 100 || !Number.isSafeInteger(listPage) || listPage < 1) return { page: 'catalog-list' }
    return {
      page: 'catalog-list',
      ...(rawSearch ? { search: rawSearch } : {}),
      ...(listPage > 1 ? { listPage } : {}),
    }
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
  if (route.page === 'catalog-list') {
    const parameters: string[] = []
    if (route.search?.trim()) parameters.push(`search=${encodeURIComponent(route.search.trim())}`)
    if (route.listPage && route.listPage > 1) parameters.push(`page=${route.listPage}`)
    return parameters.length ? `/catalogs?${parameters.join('&')}` : '/catalogs'
  }
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

/** AppShell이 route별 제목과 직접 진입 시의 안전한 복귀 위치를 한 계약으로 사용한다. */
export function routePresentation(route: AppRoute): RoutePresentation {
  if (route.page === 'dashboard') return { title: '대시보드', context: '장비 운영', showBack: false }
  if (route.page === 'scan') return { title: '장비 스캔', context: '장비 운영', showBack: false }
  if (route.page === 'catalog-list') return { title: '장비 카탈로그', context: '장비 운영', showBack: false }
  if (route.page === 'catalog-view') return { title: '카탈로그 상세', context: '장비 카탈로그', showBack: true, fallbackRoute: { page: 'catalog-list' } }
  if (route.page === 'catalog-add') return { title: '새 카탈로그', context: '장비 카탈로그', showBack: true, fallbackRoute: { page: 'catalog-list' } }
  if (route.page === 'catalog-ai-add') return { title: 'AI 카탈로그 작성', context: '장비 카탈로그', showBack: true, fallbackRoute: { page: 'catalog-list' } }
  if (route.page === 'catalog-ai-edit') return { title: 'AI 카탈로그 수정', context: '장비 카탈로그', showBack: true, fallbackRoute: { page: 'catalog-view', catalogKey: route.catalogKey } }
  if (route.page === 'catalog-edit-json' || route.page === 'catalog-edit-thumbnail'
    || route.page === 'catalog-edit-files' || route.page === 'catalog-edit-links') {
    return { title: '카탈로그 수정', context: '장비 카탈로그', showBack: true, fallbackRoute: { page: 'catalog-view', catalogKey: route.catalogKey } }
  }
  if (route.page === 'test-device') {
    const fallbackRoute: AppRoute = route.origin === 'scan'
      ? { page: 'scan' }
      : { page: 'catalog-view', catalogKey: route.catalogKey }
    return { title: '장비 연결', context: '장비 카탈로그', showBack: true, fallbackRoute }
  }
  if (route.page === 'test-group-list') return { title: '테스트 그룹', context: '장비 운영', showBack: false }
  if (route.page === 'test-group-add') return { title: '새 테스트 그룹', context: '테스트 그룹', showBack: true, fallbackRoute: { page: 'test-group-list' } }
  if (route.page === 'test-group-edit') return { title: '테스트 그룹 수정', context: '테스트 그룹', showBack: true, fallbackRoute: { page: 'test-group-list' } }
  return { title: '테스트 그룹 실행', context: '테스트 그룹', showBack: true, fallbackRoute: { page: 'test-group-list' } }
}

/** 브라우저나 다른 script가 넣은 임의 state를 앱 내부 이력으로 오인하지 않도록 shape와 범위를 검사한다. */
export function parseAppHistoryState(value: unknown): AppHistoryState | null {
  if (typeof value !== 'object' || value === null) return null
  if (!('owner' in value) || !('depth' in value)) return null
  if (value.owner !== HISTORY_OWNER || !Number.isSafeInteger(value.depth) || Number(value.depth) < 0) return null
  return { owner: HISTORY_OWNER, depth: Number(value.depth) }
}

export function nextAppHistoryState(current: unknown): AppHistoryState {
  const depth = parseAppHistoryState(current)?.depth ?? 0
  return { owner: HISTORY_OWNER, depth: depth + 1 }
}

export function initialAppHistoryState(current: unknown): AppHistoryState {
  return parseAppHistoryState(current) ?? { owner: HISTORY_OWNER, depth: 0 }
}
