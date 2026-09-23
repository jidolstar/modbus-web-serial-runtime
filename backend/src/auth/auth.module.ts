import { Module } from '@nestjs/common'
import { AuthController } from './auth.controller'
import { GoogleOidcService } from './google-oidc.service'
import { SameOriginGuard } from './same-origin.guard'
import { SessionAuthGuard } from './session-auth.guard'
import { SessionService } from './session.service'
import { SessionsRepository } from './sessions.repository'
import { UsersRepository } from './users.repository'

@Module({
  controllers: [AuthController],
  providers: [
    GoogleOidcService,
    SessionService,
    UsersRepository,
    SessionsRepository,
    SessionAuthGuard,
    SameOriginGuard,
  ],
  exports: [SessionAuthGuard, SameOriginGuard],
})
export class AuthModule {}
