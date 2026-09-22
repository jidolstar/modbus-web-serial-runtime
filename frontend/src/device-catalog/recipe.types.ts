/** 현재 Recipe JSON 형식의 버전이다. */
export enum RecipeSchemaVersion {
  Version1 = '1.0',
}

/** 측정 및 Probe Recipe에 현재 Slave ID를 전달할 때 사용하는 표준 parameter 이름이다. */
export const STANDARD_DEVICE_ID_PARAMETER = 'deviceId'

/** Recipe가 수행하는 업무 목적이다. */
export enum RecipeKind {
  Probe = 'probe',
  Measurement = 'measurement',
  Configuration = 'configuration',
}

/** Recipe Engine v1에서 허용하는 Step 종류다. */
export enum RecipeStepType {
  ReadHoldingRegisters = 'readHoldingRegisters',
  WriteSingleRegister = 'writeSingleRegister',
  Delay = 'delay',
  ReopenSerial = 'reopenSerial',
  Probe = 'probe',
  AssertEquals = 'assertEquals',
}

/** register 결과를 출력값으로 바꿀 때 사용하는 v1 decoder다. */
export enum RecipeDecoderType {
  Unsigned16 = 'uint16',
  Signed16 = 'int16',
}

/** 오류가 발생했을 때 Recipe v1이 취하는 정책이다. */
export enum RecipeErrorPolicy {
  Stop = 'stop',
}

/** 고정 숫자, context 참조 또는 Profile map 조회로 해석되는 Recipe 값이다. */
export type RecipeValue = number | string | RecipeMapLookup

/** Profile의 named map에서 key에 해당하는 숫자를 조회한다. */
export interface RecipeMapLookup {
  readonly map: string
  readonly key: string
}

/** Recipe 실행 전 검증할 parameter의 공통 속성이다. */
interface RecipeParameterBase {
  readonly name: string
  readonly label?: string
}

/** 범위 제한을 갖는 정수 parameter다. */
export interface IntegerRecipeParameter extends RecipeParameterBase {
  readonly type: 'integer'
  readonly minimum: number
  readonly maximum: number
}

/** 명시된 값 중 하나만 허용하는 parameter다. */
export interface EnumRecipeParameter extends RecipeParameterBase {
  readonly type: 'enum'
  readonly values: ReadonlyArray<string | number>
}

export type RecipeParameter = IntegerRecipeParameter | EnumRecipeParameter

/** 모든 Step이 공통으로 갖는 식별자와 종류다. */
interface RecipeStepBase {
  readonly id: string
  readonly type: RecipeStepType
}

/** FC03으로 Holding Register를 읽고 실행 context에 저장한다. */
export interface ReadHoldingRegistersStep extends RecipeStepBase {
  readonly type: RecipeStepType.ReadHoldingRegisters
  readonly slaveId: RecipeValue
  readonly address: number
  readonly count: number
  readonly saveAs: string
}

/** FC06으로 register 하나를 기록한다. */
export interface WriteSingleRegisterStep extends RecipeStepBase {
  readonly type: RecipeStepType.WriteSingleRegister
  readonly slaveId: RecipeValue
  readonly address: number
  readonly value: RecipeValue
}

/** 장비가 설정을 적용할 시간을 확보하기 위해 실행을 잠시 멈춘다. */
export interface DelayStep extends RecipeStepBase {
  readonly type: RecipeStepType.Delay
  readonly milliseconds: number
}

/** 현재 port를 새 Baudrate로 안전하게 다시 연다. */
export interface ReopenSerialStep extends RecipeStepBase {
  readonly type: RecipeStepType.ReopenSerial
  readonly baudRate: RecipeValue
}

/** Profile의 read-only Probe Recipe를 지정된 Slave ID로 실행한다. */
export interface ProbeStep extends RecipeStepBase {
  readonly type: RecipeStepType.Probe
  readonly slaveId: RecipeValue
}

/** 실행 context의 값이 기대값과 같은지 확인한다. */
export interface AssertEqualsStep extends RecipeStepBase {
  readonly type: RecipeStepType.AssertEquals
  readonly actual: string
  readonly expected: RecipeValue
}

export type RecipeStep =
  | ReadHoldingRegistersStep
  | WriteSingleRegisterStep
  | DelayStep
  | ReopenSerialStep
  | ProbeStep
  | AssertEqualsStep

/** 저장된 register 하나를 이름 있는 출력값으로 변환하는 선언이다. */
export interface RecipeOutput {
  readonly name: string
  readonly source: string
  readonly decoder: RecipeDecoderType
  readonly scale?: number
  readonly offset?: number
  readonly unit?: string
}

/** 허용된 Step만 순서대로 실행하는 Recipe v1 정의다. */
export interface Recipe {
  readonly schemaVersion: RecipeSchemaVersion
  readonly id: string
  readonly name: string
  readonly kind: RecipeKind
  readonly parameters?: ReadonlyArray<RecipeParameter>
  readonly steps: ReadonlyArray<RecipeStep>
  readonly outputs?: ReadonlyArray<RecipeOutput>
  readonly onError: RecipeErrorPolicy
}
