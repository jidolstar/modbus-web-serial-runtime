import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class CatalogAiSessionFileDto {
  @ApiProperty({ example: '223f503d-0bdb-4df2-a769-ecb00b512f43' }) id!: string
  @ApiProperty({ example: 'sensor-manual.pdf' }) name!: string
  @ApiProperty({ example: 428100 }) sizeBytes!: number
  @ApiProperty({ example: 'application/pdf' }) mimeType!: string
}
export class CatalogAiJobAcceptedDto {
  @ApiProperty({ example: '5c43a77e-09df-4a6a-a5f4-3d90618c85aa' }) jobId!: string
  @ApiProperty({ example: '618bb694-a46a-4740-96ba-430738670ed8' }) sessionId!: string
  @ApiProperty({ example: 'queued' }) status!: string
  @ApiProperty({ type: [CatalogAiSessionFileDto] }) files!: CatalogAiSessionFileDto[]
}
export class CatalogAiJobDto {
  @ApiProperty({ example: 'completed' }) status!: string
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'AI 제안과 서버 검증 결과입니다. validation.issues에는 공개 JSON 경로와 사용자용 원인이 포함됩니다.' }) proposal?: object
  @ApiPropertyOptional({ example: '73f1070f052dd86bb0105ad14a3b938d7316a73e48aa819873455b67d52da8e5' }) proposalDigest?: string
  @ApiPropertyOptional({ example: 'CATALOG_AI_UPSTREAM_TIMEOUT' }) errorCode?: string
}
export class CatalogAiApprovalRequestDto {
  @ApiProperty({ example: '5c43a77e-09df-4a6a-a5f4-3d90618c85aa' }) jobId!: string
  @ApiProperty({ example: '73f1070f052dd86bb0105ad14a3b938d7316a73e48aa819873455b67d52da8e5' }) proposalDigest!: string
  @ApiProperty({ type: [String], example: ['223f503d-0bdb-4df2-a769-ecb00b512f43'] }) retainedFileIds!: string[]
  @ApiProperty({ type: [String], example: ['https://example.com/sensor/manual'] }) retainedUrls!: string[]
}
export class CatalogAiApprovalResponseDto {
  @ApiProperty({ example: 'example-temperature-sensor' }) catalogKey!: string
  @ApiProperty({ example: 1 }) revision!: number
  @ApiProperty({ type: [Number], example: [12] }) promotedFileIds!: number[]
  @ApiProperty({ type: [Number], example: [8] }) createdLinkIds!: number[]
}
