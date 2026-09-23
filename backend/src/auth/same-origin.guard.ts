import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { FastifyRequest } from 'fastify'
import { AppConfig } from '../config/app-config'
import { APP_CONFIG } from '../config/config.module'
import { AUTH_ERROR_CODES } from './auth.constants'
import { AuthError } from './auth-error'

export function isAllowedRequestOrigin(
  origin: string | undefined,
  referer: string | undefined,
  allowedOrigin: string,
): boolean {
  if (origin === allowedOrigin) return true
  if (!referer) return false
  try {
    return new URL(referer).origin === allowedOrigin
  } catch {
    return false
  }
}

@Injectable()
export class SameOriginGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    if (isAllowedRequestOrigin(request.headers.origin, request.headers.referer, this.config.corsOrigin)) {
      return true
    }
    throw new AuthError(AUTH_ERROR_CODES.invalidOrigin, 403)
  }
}
