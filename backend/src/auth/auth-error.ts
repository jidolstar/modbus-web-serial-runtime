import { HttpException, HttpStatus } from '@nestjs/common'

export class AuthError extends HttpException {
  constructor(code: string, status: HttpStatus) {
    super({ code }, status)
  }
}
