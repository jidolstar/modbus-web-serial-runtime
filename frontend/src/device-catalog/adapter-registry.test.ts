import { describe, expect, it } from 'vitest'
import { CapabilityAdapterRegistry } from './adapter-registry'

describe('CapabilityAdapterRegistry', () => {
  it('matches only a predeployed capability and adapter ID pair', () => {
    const registry = new CapabilityAdapterRegistry([{ capability: 'custom-read', adapterId: 'example-v1' }])
    expect(registry.supports({ capability: 'custom-read', adapterId: 'example-v1' })).toBe(true)
    expect(registry.supports({ capability: 'custom-read', adapterId: 'untrusted-source' })).toBe(false)
  })
})
