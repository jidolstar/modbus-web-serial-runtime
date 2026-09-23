import { ApiProperty } from '@nestjs/swagger'

export class HealthResponseDto {
  @ApiProperty({ example: 'ok', description: '서비스가 요청을 처리할 수 있음을 나타냅니다.' })
  status!: string

  @ApiProperty({ example: 'modbus-backend' })
  service!: string

  @ApiProperty({ example: '2026-09-23T00:00:00.000Z', format: 'date-time' })
  timestamp!: string
}

export class ErrorResponseDto {
  @ApiProperty({
    example: 'AUTH_UNAUTHORIZED',
    description: '클라이언트가 분기 처리할 수 있는 안정적인 공개 오류 코드입니다.',
  })
  code!: string
}

export class AuthConfigurationResponseDto {
  @ApiProperty({ example: true })
  configured!: boolean

  @ApiProperty({
    type: [String],
    example: [],
    description: '누락된 환경변수 이름만 반환하며 값은 반환하지 않습니다.',
  })
  missing!: string[]
}

export class AuthUserDto {
  @ApiProperty({ example: 42 })
  id!: number

  @ApiProperty({ example: 'operator@example.com', format: 'email' })
  email!: string

  @ApiProperty({ example: 'Example Operator', nullable: true })
  displayName!: string | null

  @ApiProperty({ example: 'https://images.example.com/avatar/operator.png', nullable: true })
  avatarUrl!: string | null
}

export class CurrentUserResponseDto {
  @ApiProperty({ type: AuthUserDto })
  user!: AuthUserDto
}
