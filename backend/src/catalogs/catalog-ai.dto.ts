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
export class CatalogAiInsufficientEvidenceDto {
  @ApiProperty({ enum: ['insufficientEvidence'], example: 'insufficientEvidence' }) outcome!: 'insufficientEvidence'
  @ApiProperty({ enum: ['modbusProtocol', 'readableMeasurement', 'requestedChange'], isArray: true, example: ['readableMeasurement'], description: 'JSON을 안전하게 만들기 위해 부족한 근거 종류' }) missingEvidence!: string[]
  @ApiProperty({ type: [String], maxItems: 5, example: ['register 주소와 데이터 형식이 포함된 Modbus 자료를 찾지 못했습니다.'] }) reasons!: string[]
}
export class CatalogAiJobDto {
  @ApiProperty({ example: 'completed' }) status!: string
  @ApiPropertyOptional({ type: 'object', additionalProperties: true, description: 'AI 제안과 서버 검증 결과입니다. validation.issues에는 공개 JSON 경로와 사용자용 원인이 포함됩니다.' }) proposal?: object
  @ApiPropertyOptional({ example: '73f1070f052dd86bb0105ad14a3b938d7316a73e48aa819873455b67d52da8e5' }) proposalDigest?: string
  @ApiPropertyOptional({ type: CatalogAiInsufficientEvidenceDto, description: '자료를 보완해 다시 요청해야 하는 정상 완료 결과입니다. 이 결과에는 proposal과 digest가 없습니다.' }) insufficientEvidence?: CatalogAiInsufficientEvidenceDto
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
export class CatalogAiEditApprovalRequestDto {
  @ApiProperty({ example: '5c43a77e-09df-4a6a-a5f4-3d90618c85aa' }) jobId!: string
  @ApiProperty({ example: '73f1070f052dd86bb0105ad14a3b938d7316a73e48aa819873455b67d52da8e5' }) proposalDigest!: string
  @ApiProperty({ example: 3, minimum: 1, description: 'AI 수정 시작 때 조회한 낙관적 잠금 revision' }) baseRevision!: number
}
export class CatalogAiEditApprovalResponseDto {
  @ApiProperty({ example: 'example-temperature-sensor', description: '수정 전후 동일하게 유지되는 제품 키' }) catalogKey!: string
  @ApiProperty({ example: 4 }) revision!: number
}
