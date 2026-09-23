export type AppRoute =
  | { readonly page: 'dashboard' }
  | { readonly page: 'catalog-list'; readonly search?: string }
  | { readonly page: 'catalog-add' }
  | { readonly page: 'catalog-view'; readonly catalogKey: string }
  | { readonly page: 'catalog-edit-json'; readonly catalogKey: string }
  | { readonly page: 'catalog-edit-thumbnail'; readonly catalogKey: string }
  | { readonly page: 'catalog-edit-files'; readonly catalogKey: string }
  | { readonly page: 'catalog-edit-links'; readonly catalogKey: string }

const CATALOG_KEY_PATTERN = /^[a-z0-9][a-z0-9._-]{0,99}$/ // API URL에 허용되는 Catalog key. 예: "cwt-th04s"

/** App shell이 새로고침·뒤로가기를 같은 화면 상태로 복원할 때 현재 URL을 제한된 route로 해석한다. */
export function parseAppRoute(location: Pick<Location, 'pathname' | 'search'> = window.location): AppRoute {
  if (location.pathname === '/catalogs/add') return { page: 'catalog-add' }
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
  if (route.page === 'catalog-list') return route.search?.trim() ? `/catalogs?search=${encodeURIComponent(route.search.trim())}` : '/catalogs'
  if (route.page === 'catalog-add') return '/catalogs/add'
  if (route.page === 'catalog-view') return `/catalogs/view?id=${encodeURIComponent(route.catalogKey)}`
  const editPath = route.page.replace('catalog-edit-', '')
  return `/catalogs/edit/${editPath}?id=${encodeURIComponent(route.catalogKey)}`
}
