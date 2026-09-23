import { Global, Module } from '@nestjs/common'
import { AppConfig, loadAppConfig } from './app-config'

export const APP_CONFIG = Symbol('APP_CONFIG')

@Global()
@Module({
  providers: [
    {
      provide: APP_CONFIG,
      useFactory: (): AppConfig => loadAppConfig(),
    },
  ],
  exports: [APP_CONFIG],
})
export class ConfigModule {}
