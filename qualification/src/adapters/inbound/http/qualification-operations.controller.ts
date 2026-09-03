import { Body, Controller, Get, Headers, HttpCode, Inject, NotFoundException, Param, Post, Query, UnprocessableEntityException } from '@nestjs/common';

import { QualificationLeadNotFoundError } from '../../../app/qualification/request-qualification-execution.service.js';
import type { IGetQualificationOperationsUseCase } from '../../../ports/inbound/get-qualification-operations.use-case.js';
import { GET_QUALIFICATION_OPERATIONS_USE_CASE } from '../../../ports/inbound/get-qualification-operations.use-case.js';
import type { IRequestQualificationExecutionUseCase } from '../../../ports/inbound/request-qualification-execution.use-case.js';
import { REQUEST_QUALIFICATION_EXECUTION_USE_CASE } from '../../../ports/inbound/request-qualification-execution.use-case.js';
import {
  QUALIFICATION_LEAD_SORT_BY,
  QUALIFICATION_LEAD_SORT_DIRECTION,
} from '../../../ports/outbound/qualification-read-model.port.js';

@Controller('v1/qualification')
export class QualificationOperationsController {
  public constructor(
    @Inject(GET_QUALIFICATION_OPERATIONS_USE_CASE) private readonly operations: IGetQualificationOperationsUseCase,
    @Inject(REQUEST_QUALIFICATION_EXECUTION_USE_CASE) private readonly requestExecution: IRequestQualificationExecutionUseCase,
  ) {}

  @Get('status')
  public async getStatus(@Query('campaignId') campaignId: string, @Query('profileVersion') profileVersion: string | undefined): Promise<unknown> {
    return this.handleRequest(() => this.operations.getStatus(readString(campaignId, 'campaignId'), readPositiveIntegerOrDefault(profileVersion, 1, 'profileVersion')));
  }

  @Post('executions')
  @HttpCode(202)
  public async requestOneExecution(@Body() body: unknown, @Headers('x-correlation-id') correlationId?: string): Promise<unknown> {
    const record = readRecord(body);
    const profileVersion = record.profileVersion;
    const idempotencyKey = record.idempotencyKey;

    if (idempotencyKey !== undefined && typeof idempotencyKey !== 'string') {
      throw new UnprocessableEntityException({ message: 'idempotencyKey must be a string' });
    }

    return this.handleRequest(() => this.requestExecution.requestExecution({
      campaignId: readString(record.campaignId, 'campaignId'),
      correlationId: correlationId ?? crypto.randomUUID(),
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
      leadId: readString(record.leadId, 'leadId'),
      ...(profileVersion === undefined ? {} : { profileVersion: readPositiveInteger(profileVersion, 'profileVersion') }),
    }));
  }

  @Get('executions')
  public async listExecutions(@Query('campaignId') campaignId: string, @Query('offset') offset = '0', @Query('limit') limit = '50'): Promise<unknown> {
    return this.handleRequest(() => this.operations.listExecutions(readString(campaignId, 'campaignId'), Number(offset), Number(limit)));
  }

  @Get('executions/:executionId')
  public async getExecution(@Param('executionId') executionId: string): Promise<unknown> {
    const execution = await this.operations.getExecution(readString(executionId, 'executionId'));

    if (execution === undefined) {
      throw new NotFoundException({ message: `Qualification execution ${executionId} was not found` });
    }

    return execution;
  }

  @Get('qualified-leads')
  public async getQualifiedLeads(@Query('campaignId') campaignId: string, @Query('profileVersion') profileVersion = '1', @Query('offset') offset = '0', @Query('limit') limit = '50'): Promise<unknown> {
    return this.handleRequest(() => this.operations.getQualifiedLeads(readString(campaignId, 'campaignId'), readPositiveInteger(profileVersion, 'profileVersion'), Number(offset), Number(limit)));
  }

  @Get('leads')
  public async getLeads(
    @Query('campaignId') campaignId: string,
    @Query('profileVersion') profileVersion = '1',
    @Query('offset') offset = '0',
    @Query('limit') limit = '50',
    @Query('sortBy') sortBy = QUALIFICATION_LEAD_SORT_BY.CREATED_AT,
    @Query('sortDirection') sortDirection = QUALIFICATION_LEAD_SORT_DIRECTION.DESC,
  ): Promise<unknown> {
    return this.handleRequest(() => this.operations.getLeads(
      readString(campaignId, 'campaignId'),
      readPositiveInteger(profileVersion, 'profileVersion'),
      readNonNegativeInteger(offset, 'offset'),
      readPositiveInteger(limit, 'limit'),
      readQualificationLeadSortBy(sortBy),
      readQualificationLeadSortDirection(sortDirection),
    ));
  }

  @Get('leads/:leadId')
  public async getLead(@Param('leadId') leadId: string, @Query('campaignId') campaignId: string, @Query('profileVersion') profileVersion = '1'): Promise<unknown> {
    const lead = await this.operations.getLead(readString(campaignId, 'campaignId'), readString(leadId, 'leadId'), readPositiveInteger(profileVersion, 'profileVersion'));

    if (lead === undefined) {
      throw new NotFoundException({ message: `Qualification Lead ${leadId} was not found` });
    }

    return lead;
  }

  private async handleRequest<TResult>(request: () => Promise<TResult>): Promise<TResult> {
    try {
      return await request();
    } catch (error: unknown) {
      if (error instanceof QualificationLeadNotFoundError) {
        throw new NotFoundException({ message: error.message });
      }
      if (error instanceof Error) {
        throw new UnprocessableEntityException({ message: error.message });
      }
      throw error;
    }
  }
}

function readPositiveInteger(value: unknown, fieldPath: string): number {
  const parsed = typeof value === 'string' ? Number(value) : value;

  if (typeof parsed !== 'number' || !Number.isSafeInteger(parsed) || parsed < 1) {
    throw new UnprocessableEntityException({ message: `${fieldPath} must be a positive safe integer` });
  }

  return parsed;
}

function readNonNegativeInteger(value: string, fieldPath: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new UnprocessableEntityException({ message: fieldPath + ' must be a non-negative safe integer' });
  }

  return parsed;
}

function readQualificationLeadSortBy(value: string): QUALIFICATION_LEAD_SORT_BY {
  for (const sortBy of Object.values(QUALIFICATION_LEAD_SORT_BY)) {
    if (value === sortBy) {
      return sortBy;
    }
  }

  throw new UnprocessableEntityException({ message: 'sortBy must be a supported Qualification Lead sort field' });
}

function readQualificationLeadSortDirection(value: string): QUALIFICATION_LEAD_SORT_DIRECTION {
  if (value === QUALIFICATION_LEAD_SORT_DIRECTION.ASC || value === QUALIFICATION_LEAD_SORT_DIRECTION.DESC) {
    return value;
  }

  throw new UnprocessableEntityException({ message: 'sortDirection must be asc or desc' });
}

function readPositiveIntegerOrDefault(value: unknown, fallback: number, fieldPath: string): number {
  return value === undefined ? fallback : readPositiveInteger(value, fieldPath);
}

function readRecord(input: unknown): Record<string, unknown> {
  if (input === null || Array.isArray(input) || typeof input !== 'object') {
    throw new UnprocessableEntityException({ message: 'body must be an object' });
  }

  return Object.entries(input).reduce<Record<string, unknown>>((record, [key, value]) => ({ ...record, [key]: value }), {});
}

function readString(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new UnprocessableEntityException({ message: `${fieldPath} must be a non-empty string` });
  }

  return value;
}
