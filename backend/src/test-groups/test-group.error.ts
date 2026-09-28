import { HttpException } from '@nestjs/common'

/** Test Group API가 내부 DB 정보를 노출하지 않고 안정 code와 입력 field만 반환하게 한다. */
export class TestGroupError extends HttpException {
  public constructor(code: string, status: number, fields?: readonly string[]) {
    super(fields ? { code, fields } : { code }, status)
  }
}
