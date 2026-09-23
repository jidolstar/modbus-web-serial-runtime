import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common'
import { FastifyRequest } from 'fastify'
import { AppConfig } from '../config/app-config'
import { APP_CONFIG } from '../config/config.module'
import { AUTH_ERROR_CODES } from './auth.constants'
import { AuthError } from './auth-error'
import { SessionService } from './session.service'

@Injectable()
export class SessionAuthGuard implements CanActivate {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly sessionService: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>()
    const user = await this.sessionService.authenticate(request.cookies[this.config.auth.cookieName])
    if (!user) throw new AuthError(AUTH_ERROR_CODES.unauthorized, 401)
    request.authUser = user
    return true
  }
}
