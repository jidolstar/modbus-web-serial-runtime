import { describe, expect, it } from 'vitest'
import { initialAppHistoryState, nextAppHistoryState, parseAppHistoryState, parseAppRoute, routePresentation, routeUrl } from './catalog-route'

describe('catalog route', () => {
  it('maps list, add, view and edit URLs to stable application routes', () => {
    expect(parseAppRoute({ pathname: '/catalogs', search: '' })).toEqual({ page: 'catalog-list' })
    expect(parseAppRoute({ pathname: '/catalogs', search: '?search=CWT%20sensor' })).toEqual({ page: 'catalog-list', search: 'CWT sensor' })
    expect(parseAppRoute({ pathname: '/catalogs', search: '?search=CWT%20sensor&page=3' })).toEqual({ page: 'catalog-list', search: 'CWT sensor', listPage: 3 })
    expect(parseAppRoute({ pathname: '/catalogs/add', search: '' })).toEqual({ page: 'catalog-add' })
    expect(parseAppRoute({ pathname: '/catalogs/ai-add', search: '' })).toEqual({ page: 'catalog-ai-add' })
    expect(routeUrl({ page: 'catalog-ai-add' })).toBe('/catalogs/ai-add')
    expect(parseAppRoute({ pathname: '/catalogs/ai-edit', search: '?id=cwt-th04s' })).toEqual({ page: 'catalog-ai-edit', catalogKey: 'cwt-th04s' })
    expect(routeUrl({ page: 'catalog-ai-edit', catalogKey: 'cwt-th04s' })).toBe('/catalogs/ai-edit?id=cwt-th04s')
    expect(parseAppRoute({ pathname: '/scan', search: '' })).toEqual({ page: 'scan' })
    expect(parseAppRoute({ pathname: '/test-groups/12/run', search: '' })).toEqual({ page: 'test-group-run', groupId: 12 })
    expect(routeUrl({ page: 'test-group-edit', groupId: 12 })).toBe('/test-groups/12/edit')
    expect(parseAppRoute({ pathname: '/catalogs/add', search: '?baudRate=9600&slaveId=100' })).toEqual({ page: 'catalog-add', observedBaudRate: 9600, observedSlaveId: 100 })
    expect(parseAppRoute({ pathname: '/catalogs/view', search: '?id=cwt-th04s' })).toEqual({ page: 'catalog-view', catalogKey: 'cwt-th04s' })
    expect(parseAppRoute({ pathname: '/catalogs/edit/thumbnail', search: '?id=cwt-th04s' })).toEqual({ page: 'catalog-edit-thumbnail', catalogKey: 'cwt-th04s' })
    expect(parseAppRoute({ pathname: '/catalogs/edit', search: '?id=cwt-th04s' })).toEqual({ page: 'catalog-edit-json', catalogKey: 'cwt-th04s' })
    expect(routeUrl({ page: 'catalog-edit-json', catalogKey: 'cwt-th04s' })).toBe('/catalogs/edit/json?id=cwt-th04s')
    expect(routeUrl({ page: 'catalog-edit-files', catalogKey: 'cwt-th04s' })).toBe('/catalogs/edit/files?id=cwt-th04s')
    expect(routeUrl({ page: 'catalog-list', search: 'CWT 센서' })).toBe('/catalogs?search=CWT%20%EC%84%BC%EC%84%9C')
    expect(routeUrl({ page: 'catalog-list', search: 'CWT 센서', listPage: 3 })).toBe('/catalogs?search=CWT%20%EC%84%BC%EC%84%9C&page=3')
    expect(routeUrl({ page: 'catalog-add', observedBaudRate: 4800, observedSlaveId: 7 })).toBe('/catalogs/add?baudRate=4800&slaveId=7')
    const testDevice = { page: 'test-device' as const, name: '센서 1', catalogKey: 'cwt-th04s', catalogRevision: 3, baudRate: 4800, slaveId: 7, origin: 'catalog' as const }
    expect(parseAppRoute({ pathname: '/test-device', search: `?${routeUrl(testDevice).split('?')[1]}` })).toEqual(testDevice)
  })

  it('rejects an unsafe or missing Catalog key instead of sending it to the API', () => {
    expect(parseAppRoute({ pathname: '/catalogs/view', search: '?id=../../secret' })).toEqual({ page: 'catalog-list' })
    expect(parseAppRoute({ pathname: '/catalogs/ai-edit', search: '?id=../../secret' })).toEqual({ page: 'catalog-list' })
    expect(parseAppRoute({ pathname: '/catalogs/edit/links', search: '' })).toEqual({ page: 'catalog-list' })
    expect(parseAppRoute({ pathname: '/catalogs', search: `?search=${'a'.repeat(101)}` })).toEqual({ page: 'catalog-list' })
    expect(parseAppRoute({ pathname: '/catalogs', search: '?page=0' })).toEqual({ page: 'catalog-list' })
    expect(parseAppRoute({ pathname: '/catalogs/add', search: '?baudRate=javascript&slaveId=-1' })).toEqual({ page: 'catalog-add' })
    expect(parseAppRoute({ pathname: '/test-device', search: '?name=x&catalog=../../secret&revision=1&baudRate=4800&slaveId=1&origin=catalog' })).toEqual({ page: 'catalog-list' })
    expect(parseAppRoute({ pathname: '/test-groups/not-a-number/run', search: '' })).toEqual({ page: 'dashboard' })
  })

  it('defines safe parent fallbacks for detail routes', () => {
    expect(routePresentation({ page: 'test-group-list' }).showBack).toBe(false)
    expect(routePresentation({ page: 'test-group-run', groupId: 7 }).fallbackRoute).toEqual({ page: 'test-group-list' })
    expect(routePresentation({ page: 'catalog-ai-edit', catalogKey: 'example-sensor' }).fallbackRoute).toEqual({ page: 'catalog-view', catalogKey: 'example-sensor' })
    expect(routePresentation({ page: 'test-device', name: '센서', catalogKey: 'example-sensor', catalogRevision: 1, baudRate: 9600, slaveId: 1, origin: 'scan' }).fallbackRoute).toEqual({ page: 'scan' })
  })

  it('accepts only app-owned history state and increments its depth', () => {
    expect(parseAppHistoryState(null)).toBeNull()
    expect(parseAppHistoryState({ owner: 'other-app', depth: 3 })).toBeNull()
    expect(parseAppHistoryState({ owner: 'modbus-manager', depth: -1 })).toBeNull()
    expect(initialAppHistoryState(null)).toEqual({ owner: 'modbus-manager', depth: 0 })
    expect(nextAppHistoryState({ owner: 'modbus-manager', depth: 2 })).toEqual({ owner: 'modbus-manager', depth: 3 })
  })
})
