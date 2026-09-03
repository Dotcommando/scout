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
import { DISCOVERY_SOURCE_KIND } from '../../../domain/discovery/discovery-model.js';
import type {
  IDiscoveryConfigurationPage,
  IGetDiscoveryConfigurationsUseCase,
} from '../../../ports/inbound/get-discovery-configurations.use-case.js';
import {
  GET_DISCOVERY_CONFIGURATIONS_USE_CASE,
} from '../../../ports/inbound/get-discovery-configurations.use-case.js';
import type {
  IManageDiscoveryConfigurationsUseCase,
} from '../../../ports/inbound/manage-discovery-configurations.use-case.js';
import {
  MANAGE_DISCOVERY_CONFIGURATIONS_USE_CASE,
} from '../../../ports/inbound/manage-discovery-configurations.use-case.js';

@Controller('v1/discovery/configurations')
export class DiscoveryConfigurationController {
  public constructor(
    @Inject(GET_DISCOVERY_CONFIGURATIONS_USE_CASE)
    private readonly getDiscoveryConfigurationsUseCase: IGetDiscoveryConfigurationsUseCase,
    @Inject(MANAGE_DISCOVERY_CONFIGURATIONS_USE_CASE)
    private readonly manageDiscoveryConfigurationsUseCase: IManageDiscoveryConfigurationsUseCase,
  ) {}

  @Get()
  public async getConfigurations(
    @Query('offset') offsetValue = '0',
    @Query('limit') limitValue = '50',
  ): Promise<IDiscoveryConfigurationPage> {
    return this.handleRequest(() => this.getDiscoveryConfigurationsUseCase.getConfigurations(
      Number(offsetValue),
      Number(limitValue),
    ));
  }

  @Post()
  public async createConfiguration(
    @Body() body: unknown,
  ): Promise<IStoredDiscoveryCampaignConfiguration> {
    return this.handleRequest(() => this.manageDiscoveryConfigurationsUseCase.createConfiguration(
      parseConfigurationInput(body),
    ));
  }

  @Put(':campaignId')
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

  @Post(':campaignId/activate')
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

  @Delete()
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
