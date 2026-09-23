import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common'
import { FastifyReply } from 'fastify'

const STATUS_ERROR_CODES: Readonly<Record<number, string>> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  429: 'RATE_LIMIT_EXCEEDED',
  503: 'SERVICE_UNAVAILABLE',
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>()
    if (error instanceof HttpException) {
      const status = error.getStatus()
      const response = error.getResponse()
      if (typeof response === 'object' && response !== null && 'code' in response) {
        void reply.status(status).send(response)
        return
      }
      void reply.status(status).send({ code: STATUS_ERROR_CODES[status] ?? 'REQUEST_FAILED' })
      return
    }
    if (
      typeof error === 'object' &&
      error !== null &&
      'statusCode' in error &&
      error.statusCode === 429
    ) {
      void reply.status(429).send({ code: 'RATE_LIMIT_EXCEEDED' })
      return
    }
    void reply.status(500).send({ code: 'INTERNAL_ERROR' })
  }
}
