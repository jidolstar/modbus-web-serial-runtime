import {
  Controller,
  Get,
  Inject,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common'
import { RouteConfig } from '@nestjs/platform-fastify'
import {
  ApiBody,
  ApiCookieAuth,
  ApiExtraModels,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiResponse,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger'
import { FastifyReply, FastifyRequest } from 'fastify'
import {
  AuthConfigurationResponseDto,
  CurrentUserResponseDto,
  ErrorResponseDto,
} from '../api-docs.dto'
import { AppConfig } from '../config/app-config'
import { APP_CONFIG } from '../config/config.module'
import {
  AUTH_ERROR_CODES,
  LOGIN_RATE_LIMIT_MAX,
  LOGIN_RATE_LIMIT_WINDOW,
  OAUTH_TEMP_COOKIE_NAME,
  OAUTH_TEMP_TTL_SECONDS,
} from './auth.constants'
import { AuthError } from './auth-error'
import { OAUTH_COOKIE_OPTIONS, SESSION_COOKIE_OPTIONS } from './cookie-options'
import { GoogleOidcService } from './google-oidc.service'
import { SameOriginGuard } from './same-origin.guard'
import { SessionAuthGuard } from './session-auth.guard'
import { SessionService } from './session.service'

@ApiTags('Authentication')
@ApiExtraModels(AuthConfigurationResponseDto, CurrentUserResponseDto, ErrorResponseDto)
@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly googleOidcService: GoogleOidcService,
    private readonly sessionService: SessionService,
  ) {}

  @Get('config')
  @ApiOperation({
    summary: 'Google 로그인 설정 상태 확인',
    description: '누락된 환경변수 이름만 공개하며 credential 값과 허용 이메일 목록은 공개하지 않습니다.',
  })
  @ApiOkResponse({
    description: 'Google 로그인을 시작할 수 있는지 반환합니다.',
    content: {
      'application/json': {
        schema: { $ref: getSchemaPath(AuthConfigurationResponseDto) },
        examples: {
          configured: {
            summary: '로그인 설정 완료',
            value: { configured: true, missing: [] },
          },
          missingConfiguration: {
            summary: '일부 설정 누락',
            value: {
              configured: false,
              missing: ['GOOGLE_OIDC_CLIENT_ID', 'GOOGLE_OIDC_CLIENT_SECRET'],
            },
          },
        },
      },
    },
  })
  getConfig(): AppConfig['google']['status'] {
    return this.googleOidcService.getConfigurationStatus()
  }

  @Get('google')
  @ApiOperation({
    summary: 'Google 로그인 시작',
    description: 'state, nonce, PKCE를 생성하고 짧은 수명의 HttpOnly 임시 쿠키를 설정한 뒤 Google로 이동합니다.',
  })
  @ApiResponse({
    status: 302,
    description: 'Google Authorization Endpoint로 이동합니다.',
    headers: {
      Location: {
        description: 'Google 로그인 URL',
        schema: { type: 'string', example: 'https://accounts.google.com/o/oauth2/v2/auth?...' },
      },
      'Set-Cookie': {
        description: 'OAuth 검증용 Secure, HttpOnly, SameSite=Lax 임시 쿠키',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: '필수 Google 설정 또는 allowlist가 누락되었습니다.',
    type: ErrorResponseDto,
    example: {
      code: 'AUTH_CONFIGURATION_INCOMPLETE',
      missing: ['GOOGLE_OIDC_CLIENT_ID'],
    },
  })
  @ApiResponse({
    status: 429,
    description: '짧은 시간에 로그인 요청이 너무 많습니다.',
    type: ErrorResponseDto,
    example: { code: 'RATE_LIMIT_EXCEEDED' },
  })
  @RouteConfig({ rateLimit: { max: LOGIN_RATE_LIMIT_MAX, timeWindow: LOGIN_RATE_LIMIT_WINDOW } })
  async startGoogleLogin(@Res() reply: FastifyReply): Promise<void> {
    const request = await this.googleOidcService.createAuthorizationRequest()
    reply.setCookie(OAUTH_TEMP_COOKIE_NAME, request.transactionToken, {
      ...OAUTH_COOKIE_OPTIONS,
      maxAge: OAUTH_TEMP_TTL_SECONDS,
    })
    reply.redirect(request.authorizationUrl, 302)
  }

  @Get('google/callback')
  @ApiOperation({
    summary: 'Google 로그인 callback 처리',
    description: 'state, nonce, PKCE, ID token과 허용 이메일을 검증하고 DB 세션 및 HttpOnly 쿠키를 발급합니다.',
  })
  @ApiQuery({ name: 'code', required: false, description: 'Google이 발급한 일회성 authorization code' })
  @ApiQuery({ name: 'state', required: false, description: '로그인 시작 시 발급한 CSRF 방지 state' })
  @ApiQuery({ name: 'error', required: false, example: 'access_denied', description: '사용자가 로그인을 취소한 경우 Google 오류 코드' })
  @ApiResponse({
    status: 302,
    description: '세션 쿠키를 설정하고 Frontend 대시보드로 이동합니다.',
    headers: {
      Location: {
        description: '설정된 Frontend origin',
        schema: { type: 'string', example: 'https://app.example.com' },
      },
      'Set-Cookie': {
        description: 'Secure, HttpOnly, SameSite=Lax 세션 쿠키',
        schema: { type: 'string' },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'OAuth transaction 또는 Google ID token 검증에 실패했습니다.',
    type: ErrorResponseDto,
    example: { code: 'AUTH_LOGIN_FAILED' },
  })
  @ApiResponse({
    status: 403,
    description: '검증된 Google 이메일이 허용 목록에 없습니다.',
    type: ErrorResponseDto,
    example: { code: 'AUTH_FORBIDDEN' },
  })
  @ApiResponse({
    status: 429,
    description: '짧은 시간에 callback 요청이 너무 많습니다.',
    type: ErrorResponseDto,
    example: { code: 'RATE_LIMIT_EXCEEDED' },
  })
  @RouteConfig({ rateLimit: { max: LOGIN_RATE_LIMIT_MAX, timeWindow: LOGIN_RATE_LIMIT_WINDOW } })
  async completeGoogleLogin(
    @Query() query: Record<string, string | string[] | undefined>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    reply.clearCookie(OAUTH_TEMP_COOKIE_NAME, OAUTH_COOKIE_OPTIONS)
    const identity = await this.googleOidcService.completeAuthorization(
      query,
      request.cookies[OAUTH_TEMP_COOKIE_NAME],
    )
    const session = await this.sessionService.issue(identity)
    reply.setCookie(this.config.auth.cookieName, session.token, {
      ...SESSION_COOKIE_OPTIONS,
      expires: session.expiresAt,
      maxAge: this.config.auth.sessionTtlSeconds,
    })
    reply.redirect(this.config.corsOrigin, 302)
  }

  @Get('me')
  @ApiOperation({
    summary: '현재 로그인 사용자 확인',
    description: 'JWT 서명·만료와 DB 세션의 존재·만료·폐기 상태를 모두 확인합니다.',
  })
  @ApiCookieAuth('sessionCookie')
  @ApiOkResponse({
    description: '현재 활성 사용자 정보입니다. 내부 세션 식별자와 Google token은 포함하지 않습니다.',
    type: CurrentUserResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: '세션 쿠키가 없거나 변조·만료·폐기되었습니다.',
    type: ErrorResponseDto,
    example: { code: 'AUTH_UNAUTHORIZED' },
  })
  @UseGuards(SessionAuthGuard)
  getCurrentUser(@Req() request: FastifyRequest): {
    readonly user: { readonly id: number; readonly email: string; readonly displayName: string | null; readonly avatarUrl: string | null }
  } {
    const user = request.authUser
    if (!user) throw new AuthError(AUTH_ERROR_CODES.unauthorized, 401)
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
      },
    }
  }

  @Post('logout')
  @ApiOperation({
    summary: '현재 세션 로그아웃',
    description: 'DB 세션을 폐기하고 동일한 속성의 세션 쿠키를 만료시킵니다. 허용된 Frontend origin에서만 호출할 수 있습니다.',
  })
  @ApiCookieAuth('sessionCookie')
  @ApiBody({
    required: true,
    description: '명시적인 JSON 요청임을 보장하기 위한 빈 객체입니다.',
    schema: { type: 'object', additionalProperties: false, example: {} },
  })
  @ApiNoContentResponse({ description: '세션이 폐기되고 응답 body 없이 완료되었습니다.' })
  @ApiResponse({
    status: 401,
    description: '유효한 활성 세션이 없습니다.',
    type: ErrorResponseDto,
    example: { code: 'AUTH_UNAUTHORIZED' },
  })
  @ApiResponse({
    status: 403,
    description: 'Origin 또는 Referer가 허용된 Frontend origin과 일치하지 않습니다.',
    type: ErrorResponseDto,
    example: { code: 'AUTH_INVALID_ORIGIN' },
  })
  @ApiResponse({
    status: 415,
    description: '지원하지 않는 Content-Type으로 요청했습니다.',
    type: ErrorResponseDto,
    example: { code: 'REQUEST_FAILED' },
  })
  @UseGuards(SessionAuthGuard, SameOriginGuard)
  async logout(@Req() request: FastifyRequest, @Res() reply: FastifyReply): Promise<void> {
    const user = request.authUser
    if (!user) throw new AuthError(AUTH_ERROR_CODES.unauthorized, 401)
    await this.sessionService.revoke(user.sessionJtiHash)
    reply.clearCookie(this.config.auth.cookieName, SESSION_COOKIE_OPTIONS)
    reply.status(204).send()
  }
}
