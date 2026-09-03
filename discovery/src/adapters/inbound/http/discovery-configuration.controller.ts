import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  UnprocessableEntityException,
} from '@nestjs/common';

import type {
  IDiscoveryCampaignConfigurationInput,
  IStoredDiscoveryCampaignConfiguration,
} from '../../../app/discovery/discovery-campaign-configuration.js';
import {
  DiscoveryConfigurationConflictError,
  DiscoveryConfigurationNotFoundError,
} from '../../../app/discovery/manage-discovery-configurations.service.js';
import { RequestDiscoveryRunService } from '../../../app/discovery/request-discovery-run.service.js';
import { DISCOVERY_SOURCE_KIND } from '../../../domain/discovery/discovery-model.js';
import type {
  IDiscoveryConfigurationPage,
  IGetDiscoveryConfigurationsUseCase,
} from '../../../ports/inbound/get-discovery-configurations.use-case.js';
import {
  GET_DISCOVERY_CONFIGURATIONS_USE_CASE,
} from '../../../ports/inbound/get-discovery-configurations.use-case.js';
import type {
  IGetDiscoveryLeadsUseCase,
} from '../../../ports/inbound/get-discovery-leads.use-case.js';
import {
  GET_DISCOVERY_LEADS_USE_CASE,
} from '../../../ports/inbound/get-discovery-leads.use-case.js';
import type {
  IManageDiscoveryConfigurationsUseCase,
} from '../../../ports/inbound/manage-discovery-configurations.use-case.js';
import {
  MANAGE_DISCOVERY_CONFIGURATIONS_USE_CASE,
} from '../../../ports/inbound/manage-discovery-configurations.use-case.js';
import {
  DISCOVERY_LEAD_SORT_BY,
  LEAD_SORT_DIRECTION,
} from '../../../ports/outbound/discovery-lead-read-model.port.js';
import type { IDiscoveryOperationRun } from '../../../ports/outbound/discovery-operation-run-repository.port.js';
import { MongoDiscoveryOperationRunRepository } from '../../outbound/mongodb/mongo-discovery-operation-run-repository.js';
import { MongoDiscoveryCampaignConfiguration } from '../configuration/mongo-discovery-campaign-configuration.js';

@Controller('v1/discovery')
export class DiscoveryConfigurationController {
  public constructor(
    @Inject(GET_DISCOVERY_CONFIGURATIONS_USE_CASE)
    private readonly getDiscoveryConfigurationsUseCase: IGetDiscoveryConfigurationsUseCase,
    @Inject(MANAGE_DISCOVERY_CONFIGURATIONS_USE_CASE)
    private readonly manageDiscoveryConfigurationsUseCase: IManageDiscoveryConfigurationsUseCase,
    @Inject(GET_DISCOVERY_LEADS_USE_CASE)
    private readonly getDiscoveryLeadsUseCase: IGetDiscoveryLeadsUseCase,
    private readonly requestDiscoveryRunService: RequestDiscoveryRunService,
    private readonly operationRunRepository: MongoDiscoveryOperationRunRepository,
    private readonly campaignConfiguration: MongoDiscoveryCampaignConfiguration,
  ) {}

  @Get('configurations')
  public async getConfigurations(
    @Query('offset') offsetValue = '0',
    @Query('limit') limitValue = '50',
  ): Promise<IDiscoveryConfigurationPage> {
    return this.handleRequest(() => this.getDiscoveryConfigurationsUseCase.getConfigurations(
      Number(offsetValue),
      Number(limitValue),
    ));
  }

  @Get('leads')
  public getLeads(
    @Query('campaignId') campaignId: string,
    @Query('offset') offset = '0',
    @Query('limit') limit = '50',
    @Query('sortBy') sortBy = DISCOVERY_LEAD_SORT_BY.CREATED_AT,
    @Query('sortDirection') sortDirection = LEAD_SORT_DIRECTION.DESC,
  ): Promise<unknown> {
    return this.handleRequest(() => this.getDiscoveryLeadsUseCase.getLeads(
      readString(campaignId, 'campaignId'),
      readNonNegativeInteger(offset, 'offset'),
      readPositiveIntegerString(limit, 'limit'),
      readDiscoveryLeadSortBy(sortBy),
      readLeadSortDirection(sortDirection),
    ));
  }

  @Post('runs')
  @HttpCode(202)
  public async requestRun(@Body() body: unknown): Promise<IDiscoveryOperationRun> {
    const record = readRecord(body);
    const optionalIdempotencyKey = record.idempotencyKey;

    if (optionalIdempotencyKey !== undefined && typeof optionalIdempotencyKey !== 'string') {
      throw new UnprocessableEntityException({ message: 'idempotencyKey must be a string' });
    }

    return this.handleRequest(() => this.requestDiscoveryRunService.requestRun({
      campaignId: readString(record.campaignId, 'campaignId'),
      ...(optionalIdempotencyKey === undefined ? {} : { idempotencyKey: optionalIdempotencyKey }),
      maximumProviderItems: readPositiveInteger(record.maximumProviderItems, 'maximumProviderItems'),
    }));
  }

  @Get('runs')
  public async getRuns(
    @Query('campaignId') campaignId: string | undefined,
    @Query('offset') offsetValue = '0',
    @Query('limit') limitValue = '50',
  ): Promise<unknown> {
    const offset = Number(offsetValue);
    const limit = Number(limitValue);

    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
      throw new UnprocessableEntityException({ message: 'offset and limit are invalid' });
    }

    const page = await this.operationRunRepository.listRuns(campaignId, offset, limit);

    return { ...page, limit, offset };
  }

  @Get('runs/:runId')
  public async getRun(
    @Param('runId') runId: string,
  ): Promise<IDiscoveryOperationRun> {
    const run = await this.operationRunRepository.findRun(runId);

    if (run === undefined) {
      throw new NotFoundException({ message: `Discovery run ${runId} was not found` });
    }

    return run;
  }

  @Get('status')
  public async getStatus(
    @Query('campaignId') campaignId: string,
  ): Promise<unknown> {
    const configuration = this.campaignConfiguration.getCampaignConfiguration();

    if (campaignId !== configuration.campaignId) {
      throw new NotFoundException({ message: `Discovery campaign ${campaignId} is not active` });
    }

    const runs = await this.operationRunRepository.listRuns(campaignId, 0, 100);
    const statusCounts = runs.items.reduce<Record<string, number>>(
      (counts, run) => ({
        ...counts,
        [run.status]: (counts[run.status] ?? 0) + 1,
      }),
      {},
    );

    return {
      activeConfiguration: {
        campaignId: configuration.campaignId,
        configurationHash: configuration.configurationHash,
        version: configuration.version,
      },
      campaignId,
      runStatusCounts: statusCounts,
    };
  }

  @Post('configurations')
  public async createConfiguration(
    @Body() body: unknown,
  ): Promise<IStoredDiscoveryCampaignConfiguration> {
    return this.handleRequest(() => this.manageDiscoveryConfigurationsUseCase.createConfiguration(
      parseConfigurationInput(body),
    ));
  }

  @Put('configurations/:campaignId')
  public async replaceConfiguration(
    @Param('campaignId') campaignId: string,
    @Body() body: unknown,
  ): Promise<IStoredDiscoveryCampaignConfiguration> {
    const record = readRecord(body);

    return this.handleRequest(() => this.manageDiscoveryConfigurationsUseCase.replaceConfiguration(
      campaignId,
      readPositiveInteger(record.expectedVersion, 'expectedVersion'),
      parseConfigurationInput(record),
    ));
  }

  @Post('configurations/:campaignId/activate')
  public async activateConfiguration(
    @Param('campaignId') campaignId: string,
    @Body() body: unknown,
  ): Promise<IStoredDiscoveryCampaignConfiguration> {
    const record = readRecord(body);

    return this.handleRequest(() => this.manageDiscoveryConfigurationsUseCase.activateConfiguration(
      campaignId,
      readPositiveInteger(record.expectedVersion, 'expectedVersion'),
    ));
  }

  @Delete('configurations')
  @HttpCode(200)
  public async archiveConfigurations(
    @Body() body: unknown,
  ): Promise<unknown> {
    const record = readRecord(body);

    return this.handleRequest(() => this.manageDiscoveryConfigurationsUseCase.archiveConfigurations(
      readStringArray(record.campaignIds, 'campaignIds'),
    ));
  }

  private async handleRequest<TResult>(request: () => Promise<TResult>): Promise<TResult> {
    try {
      return await request();
    } catch (error: unknown) {
      if (error instanceof DiscoveryConfigurationNotFoundError) {
        throw new NotFoundException({ message: error.message });
      }
      if (error instanceof DiscoveryConfigurationConflictError) {
        throw new ConflictException({ message: error.message });
      }
      if (error instanceof Error) {
        throw new UnprocessableEntityException({ message: error.message });
      }

      throw error;
    }
  }
}

function parseConfigurationInput(input: unknown): IDiscoveryCampaignConfigurationInput {
  const record = readRecord(input);
  const source = readRecord(record.source);
  const limits = readRecord(record.limits);
  const rawScopes = record.scopes;

  if (!Array.isArray(rawScopes)) {
    throw new UnprocessableEntityException({ message: 'scopes must be an array' });
  }

  return {
    campaignId: readString(record.campaignId, 'campaignId'),
    limits: {
      dailyProviderItemLimit: readPositiveInteger(
        limits.dailyProviderItemLimit,
        'limits.dailyProviderItemLimit',
      ),
      maxProviderItemsPerRun: readPositiveInteger(
        limits.maxProviderItemsPerRun,
        'limits.maxProviderItemsPerRun',
      ),
    },
    scopes: rawScopes.map((scope, index) => {
      const scopeRecord = readRecord(scope);

      return {
        id: readString(scopeRecord.id, `scopes[${index}].id`),
        label: readString(scopeRecord.label, `scopes[${index}].label`),
        priority: readPositiveInteger(scopeRecord.priority, `scopes[${index}].priority`),
      };
    }),
    searchQueries: readStringArray(record.searchQueries, 'searchQueries'),
    source: {
      actorId: readString(source.actorId, 'source.actorId'),
      kind: readSourceKind(source.kind),
    },
  };
}

function readRecord(input: unknown): Record<string, unknown> {
  if (input === null || Array.isArray(input) || typeof input !== 'object') {
    throw new UnprocessableEntityException({ message: 'body must be an object' });
  }

  return Object.entries(input).reduce<Record<string, unknown>>(
    (record, [key, value]) => ({ ...record, [key]: value }),
    {},
  );
}

function readPositiveInteger(value: unknown, fieldPath: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new UnprocessableEntityException({ message: `${fieldPath} must be a positive safe integer` });
  }

  return value;
}

function readNonNegativeInteger(value: string, fieldPath: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new UnprocessableEntityException({ message: fieldPath + ' must be a non-negative safe integer' });
  }

  return parsed;
}

function readPositiveIntegerString(value: string, fieldPath: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new UnprocessableEntityException({ message: fieldPath + ' must be a positive safe integer' });
  }

  return parsed;
}

function readDiscoveryLeadSortBy(value: string): DISCOVERY_LEAD_SORT_BY {
  if (value === DISCOVERY_LEAD_SORT_BY.CREATED_AT || value === DISCOVERY_LEAD_SORT_BY.NAME) {
    return value;
  }

  throw new UnprocessableEntityException({ message: 'sortBy must be a supported Discovery Lead sort field' });
}

function readLeadSortDirection(value: string): LEAD_SORT_DIRECTION {
  if (value === LEAD_SORT_DIRECTION.ASC || value === LEAD_SORT_DIRECTION.DESC) {
    return value;
  }

  throw new UnprocessableEntityException({ message: 'sortDirection must be asc or desc' });
}

function readSourceKind(value: unknown): DISCOVERY_SOURCE_KIND {
  if (value !== DISCOVERY_SOURCE_KIND.GOOGLE_MAPS) {
    throw new UnprocessableEntityException({ message: 'source.kind must be google-maps' });
  }

  return DISCOVERY_SOURCE_KIND.GOOGLE_MAPS;
}

function readString(value: unknown, fieldPath: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new UnprocessableEntityException({ message: `${fieldPath} must be a non-empty string` });
  }

  return value;
}

function readStringArray(value: unknown, fieldPath: string): readonly string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new UnprocessableEntityException({ message: `${fieldPath} must be a non-empty array` });
  }

  return value.map((item, index) => readString(item, `${fieldPath}[${index}]`));
}
