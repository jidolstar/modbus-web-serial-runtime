import { describe, expect, it } from 'vitest'
import { MockSerialTransport } from '../serial/testing/mock-serial-transport'
import { TestBusSession } from './test-bus-session'

/** port chooser를 다시 열기 전에 기존 연결 종료가 완료됐는지 호출 순서로 기록한다. */
class LifecycleTrackingTransport extends MockSerialTransport {
  public readonly lifecycle: string[] = []

  public override async close(): Promise<void> {
    this.lifecycle.push('close')
    await super.close()
  }

  public override async requestPort(): Promise<void> {
    this.lifecycle.push('request-port')
    await super.requestPort()
  }
}

describe('TestBusSession', () => {
  it('열린 port를 먼저 닫은 뒤 새 port 선택을 요청한다', async () => {
    const transport = new LifecycleTrackingTransport()
    const session = new TestBusSession(transport)

    await session.requestPort()

    expect(transport.lifecycle).toEqual(['close', 'request-port'])
    expect(session.hasSelectedPort).toBe(true)
    await session.dispose()
  })
})
