import type { SerialConfig } from '@modbus-manager/device-catalog-domain'
import type { CatalogDetail } from '../device-catalog/catalog-api'

export type TestDeviceOrigin = 'catalog' | 'scan'

/** Catalog 정의와 현장 통신값을 결합한 브라우저 로컬 테스트 대상이다. */
export interface TestDevice {
  readonly name: string // 화면에서 구분하는 이름. 예: "온습도 센서 1"
  readonly catalogKey: string // 실행할 Catalog의 안정 key. 예: "cwt-th04s"
  readonly catalogRevision: number // 생성 시 검증한 Catalog revision. 예: 3
  readonly serialConfig: SerialConfig // Web Serial port를 열 때 사용할 검증된 설정
  readonly slaveId: number // Modbus 요청 대상 주소. 예: 1
  readonly origin: TestDeviceOrigin // 생성 진입점이며 장비 식별 결과를 뜻하지 않는다.
}

export interface TestDeviceInput {
  readonly name: string
  readonly baudRate: number
  readonly slaveId: number
  readonly origin: TestDeviceOrigin
}

export interface TestDeviceCatalogCompatibility {
  readonly baudRateSupported: boolean // 관찰 baudrate가 Catalog allowlist에 포함되면 true다.
  readonly slaveIdSupported: boolean // 관찰 Slave ID가 Catalog 범위 안의 정수이면 true다.
}

const MAX_TEST_DEVICE_NAME_LENGTH = 100 // URL과 향후 DB 저장에 안전한 표시 이름 상한. 예: 100자

/** Scan 생성 모달에서 관찰한 통신값과 선택 Catalog의 허용 범위를 I/O 전에 비교한다. */
export function checkTestDeviceCatalogCompatibility(
  catalog: CatalogDetail,
  baudRate: number | null,
  slaveId: number | null,
): TestDeviceCatalogCompatibility {
  const profile = catalog.definition.profile
  return Object.freeze({
    baudRateSupported: baudRate !== null
      && Number.isInteger(baudRate)
      && profile.serial.supportedBaudRates.includes(baudRate),
    slaveIdSupported: slaveId !== null
      && Number.isInteger(slaveId)
      && slaveId >= profile.slave.minId
      && slaveId <= profile.slave.maxId,
  })
}

/** 생성·수정 모달과 route 복원에서 호출해 Catalog 범위를 벗어난 통신값을 I/O 전에 차단한다. */
export function createTestDevice(catalog: CatalogDetail, input: TestDeviceInput): TestDevice {
  const name = input.name.trim()
  if (!name || name.length > MAX_TEST_DEVICE_NAME_LENGTH) {
    throw new Error(`테스트 장비 이름은 1~${MAX_TEST_DEVICE_NAME_LENGTH}자여야 합니다.`)
  }
  const profile = catalog.definition.profile
  const compatibility = checkTestDeviceCatalogCompatibility(catalog, input.baudRate, input.slaveId)
  if (!compatibility.baudRateSupported) {
    throw new Error('Catalog가 지원하는 baudrate를 선택해 주세요.')
  }
  if (!compatibility.slaveIdSupported) {
    throw new Error(`Slave ID는 ${profile.slave.minId}~${profile.slave.maxId} 정수여야 합니다.`)
  }

  return Object.freeze({
    name,
    catalogKey: catalog.catalogKey,
    catalogRevision: catalog.revision,
    serialConfig: Object.freeze({ ...profile.serial.default, baudRate: input.baudRate }),
    slaveId: input.slaveId,
    origin: input.origin,
  })
}
