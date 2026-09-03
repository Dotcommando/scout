import { Body, ConflictException, Controller, Delete, Get, HttpCode, Inject, NotFoundException, Param, Post, Put, Query, UnprocessableEntityException } from '@nestjs/common';

import { QualificationConfigurationConflictError, QualificationConfigurationNotFoundError } from '../../../app/qualification/manage-qualification-configurations.service.js';
import { IQualificationConfigurationInput, IStoredQualificationConfiguration } from '../../../app/qualification/qualification-configuration.js';
import { KNOWN_AFFILIATION_SCOPE } from '../../../domain/qualification/qualification-model.js';
import type { IGetQualificationConfigurationsUseCase, IQualificationConfigurationPage } from '../../../ports/inbound/get-qualification-configurations.use-case.js';
import { GET_QUALIFICATION_CONFIGURATIONS_USE_CASE } from '../../../ports/inbound/get-qualification-configurations.use-case.js';
import type { IManageQualificationConfigurationsUseCase } from '../../../ports/inbound/manage-qualification-configurations.use-case.js';
import { MANAGE_QUALIFICATION_CONFIGURATIONS_USE_CASE } from '../../../ports/inbound/manage-qualification-configurations.use-case.js';

@Controller('v1/qualification/configurations')
export class QualificationConfigurationController {
  public constructor(
    @Inject(GET_QUALIFICATION_CONFIGURATIONS_USE_CASE) private readonly getConfigurationsUseCase: IGetQualificationConfigurationsUseCase,
    @Inject(MANAGE_QUALIFICATION_CONFIGURATIONS_USE_CASE) private readonly manageConfigurationsUseCase: IManageQualificationConfigurationsUseCase,
  ) {}

  @Get()
  public async getConfigurations(@Query('offset') offset = '0', @Query('limit') limit = '50'): Promise<IQualificationConfigurationPage> {
    return this.handleRequest(() => this.getConfigurationsUseCase.getConfigurations(Number(offset), Number(limit)));
  }

  @Post()
  public async createConfiguration(@Body() body: unknown): Promise<IStoredQualificationConfiguration> {
    return this.handleRequest(() => this.manageConfigurationsUseCase.createConfiguration(parseConfigurationInput(body)));
  }

  @Put(':campaignId')
  public async replaceConfiguration(@Param('campaignId') campaignId: string, @Body() body: unknown): Promise<IStoredQualificationConfiguration> {
    const record = readRecord(body);

    return this.handleRequest(() => this.manageConfigurationsUseCase.replaceConfiguration(campaignId, readPositiveInteger(record.expectedVersion, 'expectedVersion'), parseConfigurationInput(record)));
  }

  @Post(':campaignId/activate')
  public async activateConfiguration(@Param('campaignId') campaignId: string, @Body() body: unknown): Promise<IStoredQualificationConfiguration> {
    const record = readRecord(body);

    return this.handleRequest(() => this.manageConfigurationsUseCase.activateConfiguration(campaignId, readPositiveInteger(record.expectedVersion, 'expectedVersion')));
  }

  @Delete()
  @HttpCode(200)
  public async archiveConfigurations(@Body() body: unknown): Promise<unknown> {
    const record = readRecord(body);

    return this.handleRequest(() => this.manageConfigurationsUseCase.archiveConfigurations(readStringArray(record.campaignIds, 'campaignIds')));
  }

  private async handleRequest<TResult>(request: () => Promise<TResult>): Promise<TResult> {
    try {
      return await request();
    } catch (error: unknown) {
      if (error instanceof QualificationConfigurationNotFoundError) {
        throw new NotFoundException({ message: error.message });
      }
      if (error instanceof QualificationConfigurationConflictError) {
        throw new ConflictException({ message: error.message });
      }
      if (error instanceof Error) {
        throw new UnprocessableEntityException({ message: error.message });
      }
      throw error;
    }
  }
}

function parseConfigurationInput(input: unknown): IQualificationConfigurationInput {
  const record = readRecord(input);
  const enrichment = readRecord(record.enrichment);
  const requirements = readRecord(record.requirements);
  const identities = readArray(record.excludedSourceIdentities, 'excludedSourceIdentities').map((value, index) => {
    const identity = readRecord(value);

    return { externalId: readString(identity.externalId, `excludedSourceIdentities[${index}].externalId`), sourceKind: readString(identity.sourceKind, `excludedSourceIdentities[${index}].sourceKind`) };
  });
  const rawScopes = record.knownAffiliationScopes;
  const knownAffiliationScopes = rawScopes === undefined ? undefined : readArray(rawScopes, 'knownAffiliationScopes').map(readKnownAffiliationScope);

  return {
    campaignId: readString(record.campaignId, 'campaignId'),
    catalogRevision: readString(record.catalogRevision, 'catalogRevision'),
    enrichment: {
      actorDefinitionId: readString(enrichment.actorDefinitionId, 'enrichment.actorDefinitionId'),
      actorRevision: readString(enrichment.actorRevision, 'enrichment.actorRevision'),
      amenityCatalogue: readStringArray(enrichment.amenityCatalogue, 'enrichment.amenityCatalogue'),
      cachePolicyRevision: readString(enrichment.cachePolicyRevision, 'enrichment.cachePolicyRevision'),
      currency: readString(enrichment.currency, 'enrichment.currency'),
      enabled: readBoolean(enrichment.enabled, 'enrichment.enabled'),
      guests: readPositiveInteger(enrichment.guests, 'enrichment.guests'),
      locale: readString(enrichment.locale, 'enrichment.locale'),
      nights: readPositiveInteger(enrichment.nights, 'enrichment.nights'),
    },
    excludedSourceIdentities: identities,
    excludedWebsiteHosts: readStringArray(record.excludedWebsiteHosts, 'excludedWebsiteHosts'),
    ...(knownAffiliationScopes === undefined ? {} : { knownAffiliationScopes }),
    profileId: readString(record.profileId, 'profileId'),
    requirements: {
      address: readBoolean(requirements.address, 'requirements.address'),
      name: readBoolean(requirements.name, 'requirements.name'),
      phoneNumber: readBoolean(requirements.phoneNumber, 'requirements.phoneNumber'),
      websiteUrl: readBoolean(requirements.websiteUrl, 'requirements.websiteUrl'),
    },
  };
}

function readArray(value: unknown, fieldPath: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new UnprocessableEntityException({ message: `${fieldPath} must be an array` });
  }

  return value;
}

function readBoolean(value: unknown, fieldPath: string): boolean {
  if (typeof value !== 'boolean') {
    throw new UnprocessableEntityException({ message: `${fieldPath} must be a boolean` });
  }

  return value;
}

function readKnownAffiliationScope(value: unknown, index: number): KNOWN_AFFILIATION_SCOPE {
  if (value === KNOWN_AFFILIATION_SCOPE.COLLECTION || value === KNOWN_AFFILIATION_SCOPE.FRANCHISE || value === KNOWN_AFFILIATION_SCOPE.MANAGEMENT || value === KNOWN_AFFILIATION_SCOPE.SOFT_BRAND) {
    return value;
  }
  throw new UnprocessableEntityException({ message: `knownAffiliationScopes[${index}] must be a supported enum value` });
}

function readPositiveInteger(value: unknown, fieldPath: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new UnprocessableEntityException({ message: `${fieldPath} must be a positive safe integer` });
  }

  return value;
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

function readStringArray(value: unknown, fieldPath: string): readonly string[] {
  return readArray(value, fieldPath).map((item, index) => readString(item, `${fieldPath}[${index}]`));
}
