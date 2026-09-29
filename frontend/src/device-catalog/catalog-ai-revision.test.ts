import { describe, expect, it } from 'vitest'
import type { CatalogAiProposal } from '@modbus-manager/device-catalog-domain'
import { appendCatalogAiRevision } from './catalog-ai-revision'

const proposal: CatalogAiProposal = {
  title: 'Example temperature sensor',
  definition: {},
  warnings: ['측정 범위를 확인해 주세요.'],
  assumptions: [],
  sources: [],
  validation: { valid: true, fields: [], issues: [] },
}

describe('Catalog AI revision history', () => {
  it('records the first generation without copying the full proposal', () => {
    const history = appendCatalogAiRevision([], undefined, proposal)

    expect(history).toEqual([{ revision: 1, instruction: '최초 생성', title: proposal.title, valid: true, warningCount: 1 }])
    expect(history[0]).not.toHaveProperty('definition')
  })

  it('appends a trimmed review instruction with the next revision number', () => {
    const first = appendCatalogAiRevision([], undefined, proposal)
    const second = appendCatalogAiRevision(first, '  단위를 다시 확인해 주세요.  ', {
      ...proposal,
      validation: { valid: false, fields: ['/profile'], issues: [{ path: '/profile', message: '예시 검증 오류' }] },
    })

    expect(second).toHaveLength(2)
    expect(second[1]).toMatchObject({ revision: 2, instruction: '단위를 다시 확인해 주세요.', valid: false })
  })
})
