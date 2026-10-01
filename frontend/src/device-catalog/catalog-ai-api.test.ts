import { describe, expect, it, vi } from 'vitest'
import { CatalogAiApiClient } from './catalog-ai-api'

function json(body: unknown, status = 200): Response { return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }) }

describe('CatalogAiApiClient', () => {
  it('starts a multipart job with the session cookie boundary', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ jobId: 'job-id', sessionId: 'session-id', status: 'queued', files: [] }, 202))
    const client = new CatalogAiApiClient('https://api.example.com/api/', request)
    await expect(client.createJob({ requirements: '센서 문서를 분석해 주세요.', referenceUrls: [], files: [] })).resolves.toMatchObject({ status: 'queued' })
    expect(request).toHaveBeenCalledWith(new URL('https://api.example.com/api/catalogs/ai/jobs'), expect.objectContaining({ credentials: 'include', method: 'POST' }))
    const init = request.mock.calls[0]?.[1]
    expect(init?.body).toBeInstanceOf(FormData)
    expect(new Headers(init?.headers).has('Content-Type')).toBe(false)
  })

  it('starts an edit job with a required instruction and keeps the product key in the URL', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ jobId: 'job-id', sessionId: 'session-id', status: 'queued', files: [] }, 202))
    const client = new CatalogAiApiClient('https://api.example.com/api/', request)
    await client.createEditJob('example-sensor', { revisionInstruction: '표시 형식을 수정해 주세요.', referenceUrls: [], files: [] })
    expect(request).toHaveBeenCalledWith(new URL('https://api.example.com/api/catalogs/ai/edit/example-sensor/jobs'), expect.objectContaining({ method: 'POST' }))
    const form = request.mock.calls[0]?.[1]?.body as FormData
    expect(form.get('revisionInstruction')).toBe('표시 형식을 수정해 주세요.')
    expect(form.has('catalogKey')).toBe(false)
  })

  it('approves an edit without allowing a product key in the body', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ catalogKey: 'example-sensor', revision: 4 }))
    const client = new CatalogAiApiClient('https://api.example.com/api/', request)
    await client.approveEdit('example-sensor', 'session-id', { jobId: 'job-id', proposalDigest: 'digest', baseRevision: 3 })
    const init = request.mock.calls[0]?.[1]
    expect(JSON.parse(String(init?.body))).toEqual({ jobId: 'job-id', proposalDigest: 'digest', baseRevision: 3 })
  })

  it('does not expose unexpected upstream error fields', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({ code: 'CATALOG_AI_UPSTREAM_FAILED', stack: 'private' }, 502))
    const client = new CatalogAiApiClient('https://api.example.com/api/', request)
    const error = await client.getJob('job-id').catch((reason: unknown) => reason)
    expect(error).toMatchObject({ status: 502, code: 'CATALOG_AI_UPSTREAM_FAILED' })
    expect(String(error)).not.toContain('private')
  })

  it('rejects a completed job whose proposal does not match the shared response contract', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({
      status: 'completed',
      proposal: { title: 'Broken response' },
      proposalDigest: 'digest',
    }))
    const client = new CatalogAiApiClient('https://api.example.com/api/', request)

    await expect(client.getJob('job-id')).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' })
  })

  it('accepts public server validation details for the review screen', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({
      status: 'completed',
      proposal: {
        title: 'Example sensor', definition: {}, warnings: [], assumptions: [], sources: [],
        validation: {
          valid: false,
          fields: ['/profile/recipes/changeBaudRate'],
          issues: [{ path: '/profile/recipes/changeBaudRate', message: 'targetBaud enum이 지원 속도와 같아야 합니다.' }],
        },
      },
      proposalDigest: 'digest',
    }))
    const client = new CatalogAiApiClient('https://api.example.com/api/', request)

    await expect(client.getJob('job-id')).resolves.toMatchObject({
      proposal: { validation: { valid: false, issues: [{ path: '/profile/recipes/changeBaudRate' }] } },
    })
  })

  it('accepts an insufficient-evidence completion without a proposal', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({
      status: 'completed',
      insufficientEvidence: {
        outcome: 'insufficientEvidence',
        missingEvidence: ['readableMeasurement'],
        reasons: ['register 주소와 데이터 형식이 포함된 자료를 찾지 못했습니다.'],
      },
    }))
    const client = new CatalogAiApiClient('https://api.example.com/api/', request)

    await expect(client.getJob('job-id')).resolves.toMatchObject({
      status: 'completed',
      insufficientEvidence: { missingEvidence: ['readableMeasurement'] },
    })
  })

  it('rejects a completion that mixes a proposal with insufficient evidence', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({
      status: 'completed',
      proposal: {
        title: 'Example sensor', definition: {}, warnings: [], assumptions: [], sources: [],
        validation: { valid: true, fields: [], issues: [] },
      },
      proposalDigest: 'digest',
      insufficientEvidence: {
        outcome: 'insufficientEvidence',
        missingEvidence: ['readableMeasurement'],
        reasons: ['자료가 부족합니다.'],
      },
    }))
    const client = new CatalogAiApiClient('https://api.example.com/api/', request)

    await expect(client.getJob('job-id')).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' })
  })

  it('rejects insufficient evidence before the job is completed', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(json({
      status: 'generating',
      insufficientEvidence: {
        outcome: 'insufficientEvidence',
        missingEvidence: ['modbusProtocol'],
        reasons: ['Modbus 자료가 없습니다.'],
      },
    }))
    const client = new CatalogAiApiClient('https://api.example.com/api/', request)

    await expect(client.getJob('job-id')).rejects.toMatchObject({ status: 502, code: 'INVALID_RESPONSE' })
  })

  it('discards the temporary AI session without sending a request body', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }))
    const client = new CatalogAiApiClient('https://api.example.com/api/', request)

    await client.discardSession('session-id')

    expect(request).toHaveBeenCalledWith(
      new URL('https://api.example.com/api/catalogs/ai/sessions/session-id'),
      expect.objectContaining({ credentials: 'include', method: 'DELETE' }),
    )
  })
})
