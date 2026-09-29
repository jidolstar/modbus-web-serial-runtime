import type { CatalogAiProposal } from '@modbus-manager/device-catalog-domain'

/** 검토 모달이 과거 JSON 전체를 복제하지 않고 생성 경과만 보여주기 위한 페이지 메모리 값이다. */
export interface CatalogAiRevisionSummary {
  readonly revision: number // 같은 페이지에서 성공한 결과의 순번. 최초 생성은 1
  readonly instruction: string // 최초 생성 또는 사용자가 입력한 재검토 요청
  readonly title: string // 해당 revision에서 AI가 제안한 Catalog 제목
  readonly valid: boolean // true이면 그 시점의 결과가 서버 Catalog 검증을 통과함
  readonly warningCount: number // 사용자가 확인해야 했던 경고 개수
}

/** 생성 job이 성공한 뒤 호출해 현재 결과의 짧은 이력만 남긴다. 실패한 job은 호출하지 않는다. */
export function appendCatalogAiRevision(
  history: readonly CatalogAiRevisionSummary[],
  instruction: string | undefined,
  proposal: CatalogAiProposal,
): readonly CatalogAiRevisionSummary[] {
  return [
    ...history,
    {
      revision: history.length + 1,
      instruction: instruction?.trim() || '최초 생성',
      title: proposal.title,
      valid: proposal.validation.valid,
      warningCount: proposal.warnings.length,
    },
  ]
}
