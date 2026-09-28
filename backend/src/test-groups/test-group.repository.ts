import { Inject, Injectable } from '@nestjs/common'
import { Kysely, Selectable } from 'kysely'
import { DATABASE } from '../database/database.module'
import type { DatabaseSchema, TestGroupNodesTable, TestGroupsTable } from '../database/database.types'
import type { TestGroupWriteInput } from './test-group-input'

export type TestGroupRow = Selectable<TestGroupsTable>
export type TestGroupNodeRow = Selectable<TestGroupNodesTable> & { readonly catalog_key: string }
export interface ResolvedNodeInput { readonly name: string; readonly catalogId: number; readonly catalogRevision: number; readonly slaveId: number }

/** TestGroupService가 검증한 Group을 사용자 소유권 조건과 transaction으로 저장한다. */
@Injectable()
export class TestGroupRepository {
  public constructor(@Inject(DATABASE) private readonly database: Kysely<DatabaseSchema>) {}

  public list(userId: number): Promise<TestGroupRow[]> { return this.database.selectFrom('test_groups').selectAll().where('owner_user_id', '=', userId).orderBy('updated_at', 'desc').execute() }
  public findGroup(id: number, userId: number): Promise<TestGroupRow | undefined> { return this.database.selectFrom('test_groups').selectAll().where('id', '=', id).where('owner_user_id', '=', userId).executeTakeFirst() }
  public listNodes(groupId: number): Promise<TestGroupNodeRow[]> {
    return this.database.selectFrom('test_group_nodes').innerJoin('catalog', 'catalog.id', 'test_group_nodes.catalog_id')
      .selectAll('test_group_nodes').select('catalog.catalog_key').where('test_group_id', '=', groupId).orderBy('position').execute()
  }

  public async create(userId: number, input: TestGroupWriteInput, nodes: readonly ResolvedNodeInput[]): Promise<number> {
    return this.database.transaction().execute(async (transaction) => {
      const created = await transaction.insertInto('test_groups').values({ owner_user_id: userId, name: input.name, baud_rate: input.serialConfig.baudRate, data_bits: input.serialConfig.dataBits, stop_bits: input.serialConfig.stopBits, parity: input.serialConfig.parity, flow_control: input.serialConfig.flowControl }).executeTakeFirstOrThrow()
      const groupId = Number(created.insertId)
      await transaction.insertInto('test_group_nodes').values(nodes.map((node, position) => ({ test_group_id: groupId, name: node.name, catalog_id: node.catalogId, catalog_revision: node.catalogRevision, slave_id: node.slaveId, position }))).execute()
      return groupId
    })
  }

  public async update(id: number, userId: number, revision: number, input: TestGroupWriteInput, nodes: readonly ResolvedNodeInput[]): Promise<boolean> {
    return this.database.transaction().execute(async (transaction) => {
      const result = await transaction.updateTable('test_groups').set({ name: input.name, baud_rate: input.serialConfig.baudRate, data_bits: input.serialConfig.dataBits, stop_bits: input.serialConfig.stopBits, parity: input.serialConfig.parity, flow_control: input.serialConfig.flowControl, revision: revision + 1 }).where('id', '=', id).where('owner_user_id', '=', userId).where('revision', '=', revision).executeTakeFirst()
      if (result.numUpdatedRows !== 1n) return false
      await transaction.deleteFrom('test_group_nodes').where('test_group_id', '=', id).execute()
      await transaction.insertInto('test_group_nodes').values(nodes.map((node, position) => ({ test_group_id: id, name: node.name, catalog_id: node.catalogId, catalog_revision: node.catalogRevision, slave_id: node.slaveId, position }))).execute()
      return true
    })
  }

  public async delete(id: number, userId: number): Promise<boolean> { const result = await this.database.deleteFrom('test_groups').where('id', '=', id).where('owner_user_id', '=', userId).executeTakeFirst(); return result.numDeletedRows === 1n }
}
