import type { CatalogBundle, SerialConfig } from '@modbus-manager/device-catalog-domain'

/** API와 편집 화면이 함께 적용하는 Test Group node 최대 개수다. */
export const TEST_GROUP_MAX_NODES = 30

/** Backend에 저장되는 Group node와 브라우저 실행 snapshot의 공용 application 계약이다. */
export interface TestGroupNode { readonly id: number; readonly name: string; readonly catalogKey: string; readonly catalogRevision: number; readonly slaveId: number; readonly position: number }
export interface TestGroup { readonly id: number; readonly name: string; readonly revision: number; readonly serialConfig: SerialConfig; readonly nodes: readonly TestGroupNode[]; readonly createdAt: string; readonly updatedAt: string }
export interface TestGroupNodeInput { readonly name: string; readonly catalogKey: string; readonly catalogRevision: number; readonly slaveId: number }
export interface TestGroupInput { readonly name: string; readonly serialConfig: SerialConfig; readonly nodes: readonly TestGroupNodeInput[] }
export interface TestGroupRuntimeSnapshot { readonly group: TestGroup; readonly catalogs: Readonly<Record<string, CatalogBundle>> }
