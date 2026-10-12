import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, Req, UseGuards } from '@nestjs/common'
import { ApiBody, ApiCookieAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger'
import type { FastifyRequest } from 'fastify'
import { SameOriginGuard } from '../auth/same-origin.guard'
import { SessionAuthGuard } from '../auth/session-auth.guard'
import { TestGroupDto, TestGroupErrorDto, TestGroupRuntimeSnapshotDto, TestGroupUpdateDto, TestGroupWriteDto } from './test-group.dto'
import { TestGroupError } from './test-group.error'
import { parsePositiveId, parseTestGroupInput } from './test-group-input'
import { TestGroupService } from './test-group.service'

function userId(request: FastifyRequest): number { if (!request.authUser) throw new TestGroupError('AUTH_UNAUTHORIZED', 401); return request.authUser.id }

/** 인증 사용자의 Group CRUD와 실행 snapshot HTTP 계약을 제공한다. */
@ApiTags('Test Groups') @ApiCookieAuth('sessionCookie') @UseGuards(SessionAuthGuard) @Controller('test-groups')
export class TestGroupController {
  public constructor(private readonly service: TestGroupService) {}
  @Get() @ApiOperation({ summary: '내 Test Group 목록 조회' }) @ApiOkResponse({ type: [TestGroupDto] }) @ApiResponse({ status: 401, type: TestGroupErrorDto })
  list(@Req() request: FastifyRequest) { return this.service.list(userId(request)) }
  @Get(':id') @ApiOperation({ summary: '내 Test Group 상세 조회' }) @ApiParam({ name: 'id', example: 12 }) @ApiOkResponse({ type: TestGroupDto }) @ApiResponse({ status: 401, type: TestGroupErrorDto, example: { code: 'AUTH_UNAUTHORIZED' } }) @ApiResponse({ status: 404, type: TestGroupErrorDto, example: { code: 'TEST_GROUP_NOT_FOUND' } })
  get(@Param('id') id: string, @Req() request: FastifyRequest) { return this.service.get(parsePositiveId(id), userId(request)) }
  @Post()
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: 'Test Group 생성', description: '허용된 Frontend origin에서만 Group과 node를 원자적으로 저장합니다. 각 node는 현재 활성 Catalog 정의를 사용합니다.' })
  @ApiBody({ type: TestGroupWriteDto, examples: { valid: { summary: '현재 Catalog를 사용하는 그룹', value: { name: '시험실 A 그룹', serialConfig: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }, nodes: [{ name: '온도 센서 1', catalogKey: 'example-temperature-sensor', slaveId: 1 }] } } } })
  @ApiCreatedResponse({ type: TestGroupDto, example: { id: 12, name: '시험실 A 그룹', revision: 1, serialConfig: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }, nodes: [{ id: 31, name: '온도 센서 1', catalogKey: 'example-temperature-sensor', slaveId: 1, position: 0 }], createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z' } })
  @ApiResponse({ status: 400, type: TestGroupErrorDto, example: { code: 'TEST_GROUP_CATALOG_UNAVAILABLE', fields: ['/nodes/0/catalogKey'] } })
  @ApiResponse({ status: 401, type: TestGroupErrorDto, example: { code: 'AUTH_UNAUTHORIZED' } })
  @ApiResponse({ status: 403, type: TestGroupErrorDto, example: { code: 'AUTH_INVALID_ORIGIN' } })
  create(@Body() body: unknown, @Req() request: FastifyRequest) { return this.service.create(parseTestGroupInput(body, false), userId(request)) }
  @Put(':id')
  @UseGuards(SameOriginGuard)
  @ApiOperation({ summary: 'Test Group 전체 수정', description: 'Group revision이 일치할 때 현재 Catalog 정의를 참조하는 node 배열로 교체합니다.' })
  @ApiBody({ type: TestGroupUpdateDto, examples: { valid: { summary: '그룹과 node 목록 수정', value: { name: '시험실 A 그룹', revision: 1, serialConfig: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }, nodes: [{ name: '온도 센서 1', catalogKey: 'example-temperature-sensor', slaveId: 1 }] } } } })
  @ApiOkResponse({ type: TestGroupDto, example: { id: 12, name: '시험실 A 그룹', revision: 2, serialConfig: { baudRate: 9600, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' }, nodes: [{ id: 32, name: '온도 센서 1', catalogKey: 'example-temperature-sensor', slaveId: 1, position: 0 }], createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:10:00.000Z' } })
  @ApiResponse({ status: 400, type: TestGroupErrorDto, example: { code: 'TEST_GROUP_CATALOG_UNAVAILABLE', fields: ['/nodes/0/catalogKey'] } })
  @ApiResponse({ status: 401, type: TestGroupErrorDto, example: { code: 'AUTH_UNAUTHORIZED' } })
  @ApiResponse({ status: 403, type: TestGroupErrorDto, example: { code: 'AUTH_INVALID_ORIGIN' } })
  @ApiResponse({ status: 404, type: TestGroupErrorDto, example: { code: 'TEST_GROUP_NOT_FOUND' } })
  @ApiResponse({ status: 409, type: TestGroupErrorDto, example: { code: 'TEST_GROUP_REVISION_CONFLICT' } })
  update(@Param('id') id: string, @Body() body: unknown, @Req() request: FastifyRequest) { return this.service.update(parsePositiveId(id), parseTestGroupInput(body, true), userId(request)) }
  @Delete(':id') @UseGuards(SameOriginGuard) @HttpCode(204) @ApiOperation({ summary: 'Test Group 삭제' }) @ApiNoContentResponse() @ApiResponse({ status: 401, type: TestGroupErrorDto, example: { code: 'AUTH_UNAUTHORIZED' } }) @ApiResponse({ status: 403, type: TestGroupErrorDto, example: { code: 'AUTH_INVALID_ORIGIN' } }) @ApiResponse({ status: 404, type: TestGroupErrorDto })
  async remove(@Param('id') id: string, @Req() request: FastifyRequest): Promise<void> { await this.service.delete(parsePositiveId(id), userId(request)) }
  @Post(':id/runtime-snapshot') @UseGuards(SameOriginGuard) @HttpCode(200) @ApiOperation({ summary: 'Test Group 실행 snapshot 생성', description: '실행 직전 Group 소유권과 Catalog 활성 상태를 다시 확인하고 현재 Catalog 정의로 snapshot을 만듭니다. Web Serial 통신은 브라우저에서만 수행합니다.' }) @ApiOkResponse({ type: TestGroupRuntimeSnapshotDto }) @ApiResponse({ status: 401, type: TestGroupErrorDto, example: { code: 'AUTH_UNAUTHORIZED' } }) @ApiResponse({ status: 403, type: TestGroupErrorDto, example: { code: 'AUTH_INVALID_ORIGIN' } }) @ApiResponse({ status: 404, type: TestGroupErrorDto, example: { code: 'TEST_GROUP_NOT_FOUND' } }) @ApiResponse({ status: 409, type: TestGroupErrorDto, example: { code: 'TEST_GROUP_CATALOG_UNAVAILABLE', fields: ['nodes/0/catalogKey'] } })
  runtime(@Param('id') id: string, @Req() request: FastifyRequest) { return this.service.runtimeSnapshot(parsePositiveId(id), userId(request)) }
}
