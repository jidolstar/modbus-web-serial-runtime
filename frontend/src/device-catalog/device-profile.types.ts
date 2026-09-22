import type { SerialConfig } from '../serial/serial-types'

/** 현재 Device Profile JSON 형식의 버전이다. */
export enum DeviceProfileSchemaVersion {
  Version1 = '1.0',
}

/** Device Profile이 참조하는 Recipe ID 모음이다. */
export interface DeviceRecipeReferences {
  /** 장비 존재 여부를 read-only로 확인하는 Recipe ID다. */
  readonly probe: string

  /** 장비에서 측정값이나 상태를 읽는 Recipe ID 목록이다. */
  readonly measurements?: ReadonlyArray<string>

  /** Slave ID 변경 Recipe ID다. 지원하지 않으면 생략한다. */
  readonly changeSlaveId?: string

  /** Baudrate 변경 Recipe ID다. 지원하지 않으면 생략한다. */
  readonly changeBaudRate?: string
}

/** JSON 파일 하나로 표현되는 표준 Modbus 장비의 정적 정의다. */
export interface DeviceProfile {
  readonly schemaVersion: DeviceProfileSchemaVersion
  readonly id: string
  readonly manufacturer: string
  readonly model: string
  readonly serial: {
    readonly default: SerialConfig
    readonly supportedBaudRates: ReadonlyArray<number>
  }
  readonly slave: {
    readonly defaultId: number
    readonly minId: number
    readonly maxId: number
  }
  readonly recipes: DeviceRecipeReferences

  /** Baudrate code처럼 Recipe가 이름으로 조회할 장비별 숫자 mapping이다. */
  readonly maps?: Readonly<Record<string, Readonly<Record<string, number>>>>
}

/** 목록 화면이나 선택 UI가 전체 Profile을 노출하지 않고 사용할 요약 정보다. */
export interface DeviceProfileSummary {
  readonly id: string
  readonly manufacturer: string
  readonly model: string
}
