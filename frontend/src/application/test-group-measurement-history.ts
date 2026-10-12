import { RecipeFormatterType, type RecipeOutput } from '@modbus-manager/device-catalog-domain'
import type { TestGroupNodeResult, TestGroupNodeStatus } from './test-group-run-result'
import type { TestGroupRuntimeSnapshot } from './test-group'

export const MAX_AUTOMATIC_MEASUREMENT_CYCLES = 10_000 // 한 화면 실행 메모리에서 보관할 cycle 상한. 예: 10,000

export interface AutomaticMeasurementData {
  readonly key: string // Recipe output 이름으로 CSV 열과 연결한다. 예: "temperature"
  readonly value: number | string | boolean | '' // 실패 output은 값이 없는 셀로 저장한다.
  readonly isSuccess: boolean // 해당 output 값이 이번 cycle에서 정상 생성됐는지 나타낸다.
  readonly unit?: string // Catalog Recipe가 선언한 단위. 예: "%RH"
}

export interface AutomaticDeviceMeasurement {
  readonly nodeId: number // 현재 Test Group 안에서 장비를 식별한다.
  readonly deviceInfo: {
    readonly name: string // 사용자가 Test Group에서 정한 표시 이름
    readonly catalogKey: string // runtime Catalog를 찾는 안정 key
    readonly manufacturer: string // Catalog Profile 제조사
    readonly model: string // Catalog Profile 모델
  }
  readonly communicationTarget: {
    readonly slaveId: number // 이 장비의 Modbus 주소. 예: 3
    readonly serialConfig: TestGroupRuntimeSnapshot['group']['serialConfig'] // Group이 공유하는 Serial 설정
  }
  readonly status: TestGroupNodeStatus // timeout과 중지 등 node 실행의 최종 상태
  readonly data: readonly AutomaticMeasurementData[] // 측정 Recipe output 순서를 유지한다.
}

export interface AutomaticMeasurementCycle {
  readonly cycle: number // 새 자동 측정 시작 때 1부터 증가한다.
  readonly startedAt: Date // 모든 장비 요청을 시작하기 직전의 cycle 시각
  readonly devices: readonly AutomaticDeviceMeasurement[] // Group 순서와 같은 장비 목록
}

/** 자동 측정 cycle을 실행 시점의 Catalog 정의와 node 결과를 사용해 불변 이력으로 만든다. */
export function createAutomaticMeasurementCycle(
  snapshot: TestGroupRuntimeSnapshot,
  cycle: number,
  startedAt: Date,
  results: ReadonlyArray<TestGroupNodeResult>,
): AutomaticMeasurementCycle {
  const devices = snapshot.group.nodes.map((node): AutomaticDeviceMeasurement => {
    const bundle = snapshot.catalogs[node.catalogKey]
    const recipeId = bundle?.profile.recipes.measurements?.[0]
    const recipe = bundle?.recipes.find(({ id }) => id === recipeId)
    const result = results.find(({ nodeId, cycle: resultCycle }) => nodeId === node.id && resultCycle === cycle)
    const status = result?.status ?? 'cancelled'
    const data = (recipe?.outputs ?? []).map((output) => toMeasurementData(output, result, status))

    return Object.freeze({
      nodeId: node.id,
      deviceInfo: Object.freeze({
        name: node.name,
        catalogKey: node.catalogKey,
        manufacturer: bundle?.profile.manufacturer ?? '',
        model: bundle?.profile.model ?? '',
      }),
      communicationTarget: Object.freeze({
        slaveId: node.slaveId,
        serialConfig: Object.freeze({ ...snapshot.group.serialConfig }),
      }),
      status,
      data: Object.freeze(data),
    })
  })

  return Object.freeze({ cycle, startedAt: new Date(startedAt), devices: Object.freeze(devices) })
}

/** TestGroupRunView가 새 자동 측정마다 초기화하며 cycle 순서대로 최대 10,000개를 보관한다. */
export class TestGroupMeasurementHistory {
  readonly #cycles: AutomaticMeasurementCycle[] = []

  public get count(): number { return this.#cycles.length }

  /** 새 자동 측정 실행을 시작할 때 현재 화면의 이전 누적 자료를 비운다. */
  public reset(): void {
    this.#cycles.length = 0
  }

  /** cycle 순서를 확인하며, 10,000개 상한에 도달했으면 false를 반환한다. */
  public append(cycle: AutomaticMeasurementCycle): boolean {
    if (this.#cycles.length >= MAX_AUTOMATIC_MEASUREMENT_CYCLES) return false
    const previousCycle = this.#cycles.at(-1)?.cycle ?? 0
    if (cycle.cycle !== previousCycle + 1) throw new Error('자동 측정 이력은 cycle 순서대로 추가해야 합니다.')
    this.#cycles.push(cycle)
    return true
  }

  /** CSV 다운로드에서 필요한 장비의 cycle 행만 순서대로 반환한다. */
  public forNode(nodeId: number): ReadonlyArray<{ readonly cycle: number; readonly startedAt: Date; readonly device: AutomaticDeviceMeasurement }> {
    const rows: Array<{ readonly cycle: number; readonly startedAt: Date; readonly device: AutomaticDeviceMeasurement }> = []
    for (const cycle of this.#cycles) {
      const device = cycle.devices.find(({ nodeId: candidateNodeId }) => candidateNodeId === nodeId)
      if (device) rows.push(Object.freeze({ cycle: cycle.cycle, startedAt: cycle.startedAt, device }))
    }
    return Object.freeze(rows)
  }
}

function toMeasurementData(
  output: RecipeOutput,
  result: TestGroupNodeResult | undefined,
  status: TestGroupNodeStatus,
): AutomaticMeasurementData {
  const namedOutput = result?.outputs[output.name]
  const isSuccess = status === 'succeeded' && namedOutput !== undefined
  const unit = 'format' in output
    ? output.format.type === RecipeFormatterType.Number ? output.format.unit : undefined
    : output.unit

  return Object.freeze({
    key: output.name,
    value: isSuccess ? (namedOutput?.value ?? '') : '',
    isSuccess,
    ...(unit ? { unit } : {}),
  })
}
