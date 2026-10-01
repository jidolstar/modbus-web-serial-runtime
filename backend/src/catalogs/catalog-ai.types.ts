import type { CatalogAiInsufficientEvidence, CatalogAiProposal, CatalogAiSource } from '@modbus-manager/device-catalog-domain'

export type CatalogAiJobStatus = 'queued' | 'generating' | 'validating' | 'completed' | 'failed' | 'cancelled'

export type { CatalogAiInsufficientEvidence, CatalogAiProposal, CatalogAiSource }
export interface GeminiSessionFileReference {
  readonly name: string // Gemini Files API의 삭제·상태 조회 식별자. 예: "files/example-id"
  readonly uri: string // GenerateContent fileData가 참조하는 provider URI
  readonly mimeType: string // provider가 확정한 MIME type
  readonly uploadedAt: number // Backend 기준 upload 완료 epoch milliseconds
}
export interface CatalogAiSessionFile {
  readonly id: string
  readonly originalName: string
  readonly contentType: string
  readonly byteSize: number
  readonly sha256: string
  readonly absolutePath: string
  geminiReference?: GeminiSessionFileReference // 같은 AI 세션의 재검토에서 binary 재업로드를 피하기 위한 메모리 전용 값
}
export interface CatalogAiJob {
  readonly id: string
  readonly sessionId: string
  readonly ownerUserId: number
  readonly requesterEmail: string
  readonly createdAt: number
  readonly editTarget?: { readonly catalogKey: string; readonly baseRevision: number } // AI 수정 job이 덮어쓸 수 있는 Catalog와 기준 revision을 서버가 고정한다.
  status: CatalogAiJobStatus
  upstreamResponseId?: string
  proposal?: CatalogAiProposal
  proposalDigest?: string
  insufficientEvidence?: CatalogAiInsufficientEvidence // 자료 보완 뒤 재요청할 수 있는 정상 완료 결과이며 승인 대상은 아니다.
  errorCode?: string
}
