import { Injectable } from '@nestjs/common'
import type { CatalogBundle, SerialConfig } from '@modbus-manager/device-catalog-domain'
import { CatalogRepository } from '../catalogs/catalog.repository'
import { CatalogValidationService } from '../catalogs/catalog-validation.service'
import { TestGroupError } from './test-group.error'
import type { TestGroupWriteInput } from './test-group-input'
import { TestGroupRepository, type ResolvedNodeInput, type TestGroupNodeRow, type TestGroupRow } from './test-group.repository'

export interface TestGroupNode { readonly id: number; readonly name: string; readonly catalogKey: string; readonly catalogRevision: number; readonly slaveId: number; readonly position: number }
export interface TestGroup { readonly id: number; readonly name: string; readonly revision: number; readonly serialConfig: SerialConfig; readonly nodes: readonly TestGroupNode[]; readonly createdAt: string; readonly updatedAt: string }

/** Controller의 사용자별 Group CRUD와 실행 snapshot 생성을 조정한다. */
@Injectable()
export class TestGroupService {
  public constructor(private readonly groups: TestGroupRepository, private readonly catalogs: CatalogRepository, private readonly catalogValidator: CatalogValidationService) {}

  public async list(userId: number): Promise<readonly TestGroup[]> { return Promise.all((await this.groups.list(userId)).map(async (row) => this.toGroup(row, await this.groups.listNodes(row.id)))) }
  public async get(id: number, userId: number): Promise<TestGroup> { const row = await this.requireGroup(id, userId); return this.toGroup(row, await this.groups.listNodes(id)) }

  public async create(input: TestGroupWriteInput, userId: number): Promise<TestGroup> {
    const nodes = await this.resolveNodes(input)
    const id = await this.groups.create(userId, input, nodes)
    return this.get(id, userId)
  }

  public async update(id: number, input: TestGroupWriteInput, userId: number): Promise<TestGroup> {
    const nodes = await this.resolveNodes(input)
    if (!await this.groups.update(id, userId, input.revision!, input, nodes)) {
      if (!await this.groups.findGroup(id, userId)) throw new TestGroupError('TEST_GROUP_NOT_FOUND', 404)
      throw new TestGroupError('TEST_GROUP_REVISION_CONFLICT', 409)
    }
    return this.get(id, userId)
  }

  public async delete(id: number, userId: number): Promise<void> { if (!await this.groups.delete(id, userId)) throw new TestGroupError('TEST_GROUP_NOT_FOUND', 404) }

  /** 실행 직전에 활성 상태와 revision을 다시 확인한 원자적 의미 snapshot을 만든다. */
  public async runtimeSnapshot(id: number, userId: number): Promise<{ readonly group: TestGroup; readonly catalogs: Readonly<Record<string, CatalogBundle>> }> {
    const group = await this.get(id, userId)
    const definitions: Record<string, CatalogBundle> = {}
    for (const node of group.nodes) {
      const row = await this.catalogs.findByKey(node.catalogKey)
      if (!row || !row.enabled) throw new TestGroupError('TEST_GROUP_CATALOG_UNAVAILABLE', 409, [`nodes/${node.position}/catalogKey`])
      if (row.revision !== node.catalogRevision) throw new TestGroupError('TEST_GROUP_CATALOG_REVISION_CHANGED', 409, [`nodes/${node.position}/catalogRevision`])
      definitions[node.catalogKey] = this.catalogValidator.validate(typeof row.definition_json === 'string' ? JSON.parse(row.definition_json) : row.definition_json)
    }
    return Object.freeze({ group, catalogs: Object.freeze(definitions) })
  }

  private async resolveNodes(input: TestGroupWriteInput): Promise<readonly ResolvedNodeInput[]> {
    const resolved: ResolvedNodeInput[] = []
    for (const [index, node] of input.nodes.entries()) {
      const row = await this.catalogs.findByKey(node.catalogKey)
      if (!row || !row.enabled || row.revision !== node.catalogRevision) throw new TestGroupError('TEST_GROUP_CATALOG_UNAVAILABLE', 400, [`/nodes/${index}/catalogKey`])
      const bundle = this.catalogValidator.validate(typeof row.definition_json === 'string' ? JSON.parse(row.definition_json) : row.definition_json)
      if (!bundle.profile.serial.supportedBaudRates.includes(input.serialConfig.baudRate)) throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, [`/nodes/${index}/catalogKey`])
      if (node.slaveId < bundle.profile.slave.minId || node.slaveId > bundle.profile.slave.maxId) throw new TestGroupError('TEST_GROUP_INVALID_INPUT', 400, [`/nodes/${index}/slaveId`])
      resolved.push(Object.freeze({ name: node.name, catalogId: row.id, catalogRevision: node.catalogRevision, slaveId: node.slaveId }))
    }
    return Object.freeze(resolved)
  }

  private async requireGroup(id: number, userId: number): Promise<TestGroupRow> { const row = await this.groups.findGroup(id, userId); if (!row) throw new TestGroupError('TEST_GROUP_NOT_FOUND', 404); return row }
  private async toGroup(row: TestGroupRow, nodes: readonly TestGroupNodeRow[]): Promise<TestGroup> {
    return Object.freeze({ id: row.id, name: row.name, revision: row.revision, serialConfig: Object.freeze({ baudRate: row.baud_rate, dataBits: row.data_bits, stopBits: row.stop_bits, parity: row.parity, flowControl: row.flow_control }), nodes: Object.freeze(nodes.map((node) => Object.freeze({ id: node.id, name: node.name, catalogKey: node.catalog_key, catalogRevision: node.catalog_revision, slaveId: node.slave_id, position: node.position }))), createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() })
  }
}
