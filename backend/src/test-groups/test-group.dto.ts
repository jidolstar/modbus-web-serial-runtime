import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger'

export class TestGroupSerialDto {
  @ApiProperty({ example: 9600, minimum: 300, maximum: 4_000_000 }) baudRate!: number
  @ApiProperty({ enum: [7, 8], example: 8 }) dataBits!: number
  @ApiProperty({ enum: [1, 2], example: 1 }) stopBits!: number
  @ApiProperty({ enum: ['none', 'even', 'odd'], example: 'none' }) parity!: string
  @ApiProperty({ enum: ['none', 'hardware'], example: 'none' }) flowControl!: string
}
export class TestGroupNodeWriteDto {
  @ApiProperty({ example: '온도 센서 1', maxLength: 100 }) name!: string
  @ApiProperty({ example: 'example-temperature-sensor' }) catalogKey!: string
  @ApiProperty({ example: 2, minimum: 1 }) catalogRevision!: number
  @ApiProperty({ example: 1, minimum: 1, maximum: 247 }) slaveId!: number
}
export class TestGroupWriteDto {
  @ApiProperty({ example: '시험실 A 그룹', maxLength: 100 }) name!: string
  @ApiProperty({ type: TestGroupSerialDto }) serialConfig!: TestGroupSerialDto
  @ApiProperty({ type: [TestGroupNodeWriteDto], minItems: 1, maxItems: 100 }) nodes!: TestGroupNodeWriteDto[]
}
export class TestGroupUpdateDto extends TestGroupWriteDto { @ApiProperty({ example: 1, minimum: 1 }) revision!: number }
export class TestGroupNodeDto extends TestGroupNodeWriteDto { @ApiProperty({ example: 31 }) id!: number; @ApiProperty({ example: 0 }) position!: number }
export class TestGroupDto extends TestGroupWriteDto {
  @ApiProperty({ example: 12 }) id!: number
  @ApiProperty({ example: 1 }) revision!: number
  @ApiProperty({ type: [TestGroupNodeDto] }) declare nodes: TestGroupNodeDto[]
  @ApiProperty({ example: '2026-09-25T00:00:00.000Z' }) createdAt!: string
  @ApiProperty({ example: '2026-09-25T00:10:00.000Z' }) updatedAt!: string
}
export class TestGroupErrorDto { @ApiProperty({ example: 'TEST_GROUP_INVALID_INPUT' }) code!: string; @ApiPropertyOptional({ type: [String], example: ['/nodes/0/slaveId'] }) fields?: string[] }
export class TestGroupRuntimeSnapshotDto { @ApiProperty({ type: TestGroupDto }) group!: TestGroupDto; @ApiProperty({ type: 'object', additionalProperties: true, description: 'catalogKey별 검증된 CatalogBundle입니다.' }) catalogs!: object }
