import type { CatalogCapabilityExtension } from './device-profile.types'

/** 배포된 TypeScript adapter가 지원하는 capability와 ID 조합이다. DB의 코드를 실행하지 않는다. */
export interface CapabilityAdapter { readonly capability: string; readonly adapterId: string }

/**
 * 관리 UI와 Runtime이 JSON으로 표현하기 어려운 capability의 사전 배포 adapter 존재 여부를 확인한다.
 * Catalog의 문자열은 registry 조회에만 쓰며 동적 import, eval 또는 source 실행에는 사용하지 않는다.
 */
export class CapabilityAdapterRegistry {
  private readonly keys: ReadonlySet<string>

  public constructor(adapters: readonly CapabilityAdapter[] = []) {
    this.keys = new Set(adapters.map(({ capability, adapterId }) => `${capability}:${adapterId}`))
  }

  public supports(extension: CatalogCapabilityExtension): boolean {
    return this.keys.has(`${extension.capability}:${extension.adapterId}`)
  }
}

export const capabilityAdapterRegistry = new CapabilityAdapterRegistry()
