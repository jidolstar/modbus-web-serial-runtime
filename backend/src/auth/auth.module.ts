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
  // 다른 관리 API module이 guard를 주입할 때 guard의 SessionService 의존성도 함께 해석한다.
  exports: [SessionAuthGuard, SameOriginGuard, SessionService],
})
export class AuthModule {}
