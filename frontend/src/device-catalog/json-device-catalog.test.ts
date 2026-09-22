import { describe, expect, it } from 'vitest'
import catalogIndex from '../../public/device-catalog/index.json'
import changeBaudRateRecipe from '../../public/device-catalog/cwt-th04s/change-baudrate.recipe.json'
import changeSlaveIdRecipe from '../../public/device-catalog/cwt-th04s/change-slave-id.recipe.json'
import probeRecipe from '../../public/device-catalog/cwt-th04s/probe.recipe.json'
import deviceProfile from '../../public/device-catalog/cwt-th04s/profile.json'
import measurementRecipe from '../../public/device-catalog/cwt-th04s/read-measurement.recipe.json'
import { DeviceCatalogError, DeviceCatalogValidationError } from './catalog-errors'
import type { CatalogFetch } from './json-device-catalog'
import { JsonDeviceCatalog } from './json-device-catalog'

/** 테스트 Catalog에서 실제 fetch 대신 사용할 URL별 JSON 저장소를 만든다. */
function createCatalogFiles(): Map<string, unknown> {
  return new Map<string, unknown>([
    ['/catalog/index.json', catalogIndex],
    ['/catalog/cwt-th04s/profile.json', deviceProfile],
    ['/catalog/cwt-th04s/probe.recipe.json', probeRecipe],
    ['/catalog/cwt-th04s/read-measurement.recipe.json', measurementRecipe],
    ['/catalog/cwt-th04s/change-slave-id.recipe.json', changeSlaveIdRecipe],
    ['/catalog/cwt-th04s/change-baudrate.recipe.json', changeBaudRateRecipe],
  ])
}

/** 주어진 JSON 저장소를 browser fetch와 같은 Response 계약으로 노출한다. */
function createFetch(files: Map<string, unknown>): CatalogFetch {
  return async (input) => {
    const path = input.toString()
    const body = files.get(path)
    if (body === undefined) return new Response(null, { status: 404 })
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

/** JSON 데이터가 서로 영향을 주지 않도록 깊은 복사본을 만든다. */
function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

describe('JsonDeviceCatalog', () => {
  it('index가 참조한 Profile과 Recipe를 원자적으로 로드해 조회한다', async () => {
    const catalog = new JsonDeviceCatalog('/catalog', undefined, createFetch(createCatalogFiles()))

    await catalog.load()

    expect(catalog.listProfiles()).toEqual([
      { id: 'cwt-th04s', manufacturer: 'CWT', model: 'CWT-TH04S' },
    ])
    expect(catalog.getRecipe('cwt-th04s.read-measurement').outputs).toHaveLength(2)
    expect(Object.isFrozen(catalog.getProfile('cwt-th04s'))).toBe(true)
    expect(Object.isFrozen(catalog.getProfile('cwt-th04s').serial.default)).toBe(true)
  })

  it('load 전에 조회하면 명확한 사용 순서 오류를 반환한다', () => {
    const catalog = new JsonDeviceCatalog('/catalog', undefined, createFetch(createCatalogFiles()))

    expect(() => catalog.listProfiles()).toThrowError(DeviceCatalogError)
  })

  it('Profile이 존재하지 않는 Recipe를 참조하면 전체 로딩을 거부한다', async () => {
    const files = createCatalogFiles()
    const invalidProfile = cloneJson(deviceProfile)
    invalidProfile.recipes.probe = 'missing.probe'
    files.set('/catalog/cwt-th04s/profile.json', invalidProfile)
    const catalog = new JsonDeviceCatalog('/catalog', undefined, createFetch(files))

    await expect(catalog.load()).rejects.toThrowError(/존재하지 않는 Recipe.*missing\.probe/)
    expect(() => catalog.listProfiles()).toThrowError(DeviceCatalogError)
  })

  it('장비를 변경할 수 있는 Step이 포함된 Probe를 안전하지 않은 설정으로 거부한다', async () => {
    const files = createCatalogFiles()
    const unsafeProbe = cloneJson(probeRecipe) as unknown as {
      steps: Array<Record<string, unknown>>
    }
    unsafeProbe.steps[0] = {
      id: 'unsafe-write',
      type: 'writeSingleRegister',
      slaveId: '${deviceId}',
      address: 2000,
      value: 1,
    }
    files.set('/catalog/cwt-th04s/probe.recipe.json', unsafeProbe)
    const catalog = new JsonDeviceCatalog('/catalog', undefined, createFetch(files))

    await expect(catalog.load()).rejects.toThrowError(DeviceCatalogValidationError)
    await expect(catalog.load()).rejects.toThrowError(/Probe Recipe.*readHoldingRegisters/)
  })
})
