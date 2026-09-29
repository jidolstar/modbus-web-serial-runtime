import { Inject, Injectable } from '@nestjs/common'
import { Kysely } from 'kysely'
import { DATABASE } from '../database/database.module'
import { CatalogAiRequestStatus, DatabaseSchema } from '../database/database.types'

export interface CatalogAiAuditStart {
  readonly jobId: string
  readonly requesterEmail: string
  readonly requestKind: 'generate' | 'review'
  readonly model: string
  readonly promptVersion: string
  readonly requestPayload: unknown
  readonly attachments: unknown
}

export interface CatalogAiAuditFinish {
  readonly status: CatalogAiRequestStatus
  readonly response?: unknown
  readonly upstreamResponseId?: string
  readonly errorCode?: string
  readonly errorDetail?: string
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly durationMs: number
}

/** CatalogAiService가 Gemini 호출 전후의 감사 row를 동일 job ID로 기록한다. */
@Injectable()
export class CatalogAiRequestRepository {
  public constructor(@Inject(DATABASE) private readonly database: Kysely<DatabaseSchema>) {}

  /** Gemini 호출 직전에 pending row를 만들어 timeout·process 종료도 추적 가능한 요청으로 남긴다. */
  public async start(values: CatalogAiAuditStart): Promise<void> {
    await this.database.insertInto('catalog_ai_requests').values({
      job_id: values.jobId, requester_email: values.requesterEmail, workflow: 'create', request_kind: values.requestKind,
      catalog_key_snapshot: null, base_revision: null, model: values.model, prompt_version: values.promptVersion,
      request_payload: JSON.stringify(values.requestPayload), attachments_json: JSON.stringify(values.attachments),
      response_payload: null, status: 'pending', upstream_response_id: null, error_code: null, error_detail: null,
      input_tokens: null, output_tokens: null, completed_at: null, duration_ms: null,
    }).executeTakeFirstOrThrow()
  }

  /** 같은 job의 Gemini 성공·실패·취소 결과를 갱신하며 비밀값이나 local path는 호출자가 전달하지 않는다. */
  public async finish(jobId: string, values: CatalogAiAuditFinish): Promise<void> {
    await this.database.updateTable('catalog_ai_requests').set({
      status: values.status, response_payload: values.response === undefined ? null : JSON.stringify(values.response),
      upstream_response_id: values.upstreamResponseId ?? null, error_code: values.errorCode ?? null,
      error_detail: values.errorDetail?.slice(0, 500) ?? null, input_tokens: values.inputTokens ?? null,
      output_tokens: values.outputTokens ?? null, completed_at: new Date(), duration_ms: values.durationMs,
    }).where('job_id', '=', jobId).executeTakeFirstOrThrow()
  }

  /** 운영 cleanup에서 개인정보가 포함된 감사 row를 설정된 보관기간 뒤 batch 삭제한다. */
  public async deleteExpired(cutoff: Date): Promise<number> {
    const result = await this.database.deleteFrom('catalog_ai_requests').where('requested_at', '<', cutoff).limit(500).executeTakeFirst()
    return Number(result.numDeletedRows)
  }
}
