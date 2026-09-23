import { NestFactory } from '@nestjs/core'
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify'
import cookie from '@fastify/cookie'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import multipart from '@fastify/multipart'
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger'
import { AppModule } from './app.module'
import { AppConfig } from './config/app-config'
import { APP_CONFIG } from './config/config.module'
import { HttpExceptionFilter } from './http-exception.filter'
import { CORS_ALLOWED_METHODS } from './security/cors-policy'

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // The API is only exposed through the trusted reverse-proxy Docker network.
    new FastifyAdapter({ trustProxy: true }),
  )
  const config = app.get<AppConfig>(APP_CONFIG)

  await app.register(cookie)
  await app.register(helmet, {
    // Frontend와 API가 서로 다른 HTTPS subdomain이므로 exact-origin CORS를 통과한 응답은 Browser가 읽을 수 있어야 한다.
    // 인증·Origin 검사는 그대로 유지하며 wildcard CORS를 사용하지 않는다.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  })
  await app.register(rateLimit, {
    global: false,
  })
  await app.register(multipart, {
    // Fastify 기본 1MB 제한보다 앱의 검증 상한을 먼저 적용하고, 서비스에서도 실제 stream byte를 다시 센다.
    limits: { files: 1, fields: 4, parts: 5, fileSize: Math.max(config.catalogUploads.fileMaxBytes, config.catalogUploads.thumbnailMaxBytes) },
  })
  app.useGlobalFilters(new HttpExceptionFilter())
  app.setGlobalPrefix('api')
  app.enableCors({
    origin: (origin, callback) => {
      callback(null, !origin || origin === config.corsOrigin)
    },
    credentials: true,
    // Nest 기본값은 GET/HEAD/POST뿐이므로 Catalog의 PUT/PATCH/DELETE preflight를 명시적으로 허용한다.
    methods: [...CORS_ALLOWED_METHODS],
  })

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Modbus Manager API')
    .setDescription(
      'Google 인증, 서버 관리형 세션, 장비 메타데이터를 제공하는 Backend API입니다. Web Serial/Modbus 통신은 브라우저에서 실행됩니다.',
    )
    .setVersion('0.1.0')
    .addCookieAuth(config.auth.cookieName, { type: 'apiKey', in: 'cookie' }, 'sessionCookie')
    .build()
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig)
  SwaggerModule.setup('api/docs', app, swaggerDocument, {
    jsonDocumentUrl: 'api/docs-json',
    customSiteTitle: 'Modbus Manager API Docs',
    swaggerOptions: { withCredentials: true },
  })

  await app.listen(config.port, '0.0.0.0')
}

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error'
  console.error(`Backend startup failed: ${message}`)
  process.exitCode = 1
})
