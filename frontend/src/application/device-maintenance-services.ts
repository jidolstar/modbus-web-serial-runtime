import type { DeviceCatalog } from '../device-catalog/catalog.types'
import type { RecipeRunner } from '../recipe-engine/recipe-execution.types'
import type { SerialTransport } from '../serial/serial-transport'
import { DeviceConfigurator } from './device-configurator'

/** 개발 UI나 향후 관리 화면이 사용할 장비 유지보수 서비스 모음이다. */
export interface DeviceMaintenanceServices {
  readonly configurator: DeviceConfigurator
}

/**
 * 동일 Catalog/Recipe/Serial 경계를 공유하는 장비 설정 서비스를 조립한다.
 *
 * 호출자는 SensorMonitor를 먼저 중단한 상태에서 서비스를 실행해야 한다. Phase 6에서는
 * 완성형 UI 대신 이 factory를 최소 호출 경로로 제공한다.
 */
export function createDeviceMaintenanceServices(
  catalog: DeviceCatalog,
  recipeRunner: RecipeRunner,
  serialTransport: SerialTransport,
): DeviceMaintenanceServices {
  return Object.freeze({
    configurator: new DeviceConfigurator(catalog, recipeRunner, serialTransport),
  })
}
