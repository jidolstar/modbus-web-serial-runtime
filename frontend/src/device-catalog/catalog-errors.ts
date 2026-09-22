/** Catalog fetch, schema validation 또는 참조 무결성 오류의 공통 타입이다. */
export class DeviceCatalogError extends Error {
  public constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = new.target.name
  }
}

/** JSON Schema 검증 실패 위치와 원인을 포함하는 오류다. */
export class DeviceCatalogValidationError extends DeviceCatalogError {}

/** 요청한 Profile 또는 Recipe가 Catalog에 없을 때 발생한다. */
export class DeviceCatalogEntryNotFoundError extends DeviceCatalogError {}
