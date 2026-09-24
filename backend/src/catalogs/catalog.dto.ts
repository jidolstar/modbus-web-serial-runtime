import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

const PROFILE_EXAMPLE = {
  schemaVersion: '1.0', id: 'example-temperature-sensor', manufacturer: 'Example Devices', model: 'TEMP-100',
  serial: { default: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }, supportedBaudRates: [9600] },
  slave: { defaultId: 1, minId: 1, maxId: 247 },
  recipes: { measurements: ['example-temperature-sensor.read'], changeSlaveId: 'example-temperature-sensor.change-slave-id' },
}
const RECIPE_EXAMPLE = {
  schemaVersion: '1.0', id: 'example-temperature-sensor.read', name: '온도 읽기', kind: 'measurement',
  parameters: [{ name: 'deviceId', type: 'integer', minimum: 1, maximum: 247 }],
  steps: [{ id: 'read-temperature', type: 'readHoldingRegisters', slaveId: '${deviceId}', address: 0, count: 1, saveAs: 'registers' }],
  outputs: [{ name: 'temperature', source: 'registers[0]', decoder: 'int16', scale: 0.1, unit: '°C' }], onError: 'stop',
}
const POWER_CYCLE_RECIPE_EXAMPLE = {
  schemaVersion: '1.0', id: 'example-temperature-sensor.change-slave-id', name: 'Slave ID 변경', kind: 'configuration',
  applyMode: 'after-power-cycle',
  parameters: [
    { name: 'currentId', type: 'integer', minimum: 1, maximum: 247 },
    { name: 'targetId', type: 'integer', minimum: 1, maximum: 247 },
  ],
  steps: [{ id: 'write-slave-id', type: 'writeSingleRegister', slaveId: '${currentId}', address: 16, value: '${targetId}' }],
  onError: 'stop',
}
export const CATALOG_BUNDLE_EXAMPLE = {
  bundleVersion: '1.0',
  profile: PROFILE_EXAMPLE,
  recipes: [RECIPE_EXAMPLE, POWER_CYCLE_RECIPE_EXAMPLE],
}

export class CatalogWriteRequestDto {
  @ApiProperty({ example: 'Example TEMP-100 온도 센서', maxLength: 160, description: '목록과 검색에 사용하는 사람이 읽기 쉬운 필수 제목입니다.' })
  title!: string // 관리 화면 표시 제목. 예: "Example TEMP-100 온도 센서"

  @ApiProperty({ type: 'object', additionalProperties: true, example: CATALOG_BUNDLE_EXAMPLE, description: 'CatalogBundle v1 Schema와 의미 검증을 모두 통과해야 하는 전체 정의입니다.' })
  definition!: object // Profile 하나와 참조 Recipe 전체. 예: CatalogBundle v1
}
export class CatalogUpdateRequestDto extends CatalogWriteRequestDto {
  @ApiProperty({ example: 2, minimum: 1, description: '마지막 조회에서 받은 revision입니다. 현재 값과 다르면 409를 반환합니다.' })
  revision!: number // 낙관적 잠금 번호. 예: 2
}
export class CatalogStatusRequestDto {
  @ApiProperty({ example: false, description: 'false이면 관리 목록에는 남지만 실행 Catalog 후보에서는 제외합니다.' })
  enabled!: boolean // 변경할 활성 상태. 예: false

  @ApiProperty({ example: 2, minimum: 1 })
  revision!: number // 낙관적 잠금 번호. 예: 2
}
export class CatalogSummaryDto {
  @ApiProperty({ example: 'example-temperature-sensor' }) catalogKey!: string // URL용 안정 ID
  @ApiProperty({ example: 'Example TEMP-100 온도 센서' }) title!: string // 사람용 제목
  @ApiProperty({ example: 'Example Devices' }) manufacturer!: string // JSON에서 파생한 제조사
  @ApiProperty({ example: 'TEMP-100' }) model!: string // JSON에서 파생한 모델
  @ApiProperty({ example: '1.0' }) schemaVersion!: string // Bundle Schema 버전
  @ApiProperty({ example: 2 }) revision!: number // 수정 충돌 검사용 번호
  @ApiProperty({ example: true }) enabled!: boolean // 실행 후보 포함 상태
  @ApiProperty({ example: false }) usesExtensions!: boolean // adapter capability 포함 여부
  @ApiProperty({ example: '2026-09-23T00:00:00.000Z', format: 'date-time' }) createdAt!: string // 생성 시각
  @ApiProperty({ example: '2026-09-23T01:00:00.000Z', format: 'date-time' }) updatedAt!: string // 수정 시각
}
export class CatalogDetailDto extends CatalogSummaryDto {
  @ApiProperty({ type: 'object', additionalProperties: true, example: CATALOG_BUNDLE_EXAMPLE })
  definition!: object // 검증 완료된 전체 Bundle
}
export class CatalogListResponseDto {
  @ApiProperty({ type: [CatalogSummaryDto] }) items!: CatalogSummaryDto[] // 현재 page 결과
  @ApiProperty({ example: 1 }) total!: number // 조건에 맞는 전체 개수
  @ApiProperty({ example: 20 }) limit!: number // 요청 page 크기
  @ApiProperty({ example: 0 }) offset!: number // 건너뛴 개수
}
export class CatalogValidationResponseDto {
  @ApiProperty({ example: true }) valid!: true // 서버 검증 통과 여부
  @ApiProperty({ example: 'example-temperature-sensor' }) catalogKey!: string // Profile에서 추출한 key
}
export class CatalogErrorResponseDto {
  @ApiProperty({ example: 'CATALOG_INVALID_INPUT' }) code!: string // 안정적인 공개 오류 코드
  @ApiPropertyOptional({ type: [String], example: ['/definition/profile/id'], description: '수정 가능한 공개 입력 경로이며 내부 오류는 포함하지 않습니다.' }) fields?: string[] // 오류 입력 경로
}

export class RuntimeCatalogItemDto {
  @ApiProperty({ example: 'example-temperature-sensor' }) catalogKey!: string // Profile ID와 같은 실행 key
  @ApiProperty({ example: 3, minimum: 1 }) revision!: number // 실행 중 고정할 정의 revision
  @ApiProperty({ type: 'object', additionalProperties: true, example: CATALOG_BUNDLE_EXAMPLE }) definition!: object // 검증 완료 CatalogBundle
}

export class RuntimeCatalogSnapshotDto {
  @ApiProperty({ type: [RuntimeCatalogItemDto] }) items!: RuntimeCatalogItemDto[] // 활성 Catalog 전체 snapshot
}
