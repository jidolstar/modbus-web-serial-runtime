import { HttpException } from '@nestjs/common'

/** HttpExceptionFilter가 내부 오류를 노출하지 않고 안정된 Catalog 오류만 반환하게 한다. */
export class CatalogError extends HttpException {
  public constructor(code: string, status: number, fields?: readonly string[]) {
    super(fields ? { code, fields } : { code }, status)
  }
}
