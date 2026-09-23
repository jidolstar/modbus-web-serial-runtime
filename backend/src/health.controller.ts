import { Controller, Get } from '@nestjs/common'
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger'
import { HealthResponseDto } from './api-docs.dto'

@ApiTags('Health')
@Controller('health')
export class HealthController {
  @Get()
  @ApiOperation({
    summary: 'Backend 상태 확인',
    description: '인증 없이 API 프로세스의 기본 가용성과 현재 서버 시각을 확인합니다.',
  })
  @ApiOkResponse({ type: HealthResponseDto, description: 'Backend가 정상적으로 요청을 처리합니다.' })
  check(): { status: string; service: string; timestamp: string } {
    return {
      status: 'ok',
      service: 'modbus-backend',
      timestamp: new Date().toISOString(),
    }
  }
}
