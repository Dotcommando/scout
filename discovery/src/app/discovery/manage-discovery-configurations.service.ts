import { createHash } from 'node:crypto';

import { IManageDiscoveryConfigurationsUseCase } from '../../ports/inbound/manage-discovery-configurations.use-case.js';
import { IClockPort } from '../../ports/outbound/clock.port.js';
import {
  IDiscoveryCampaignConfigurationRepositoryPort,
  IDiscoveryConfigurationArchiveResult,
} from '../../ports/outbound/discovery-campaign-configuration-repository.port.js';
import {
  IDiscoveryCampaignConfiguration,
  IDiscoveryCampaignConfigurationInput,
  IStoredDiscoveryCampaignConfiguration,
} from './discovery-campaign-configuration.js';

export class DiscoveryConfigurationConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'DiscoveryConfigurationConflictError';
  }
}

export class DiscoveryConfigurationNotFoundError extends Error {
  public constructor(campaignId: string) {
    super(`Discovery configuration ${campaignId} was not found`);
    this.name = 'DiscoveryConfigurationNotFoundError';
  }
}

export class ManageDiscoveryConfigurationsService
  implements IManageDiscoveryConfigurationsUseCase {
  public constructor(
    private readonly clock: IClockPort,
    private readonly configurationRepository: IDiscoveryCampaignConfigurationRepositoryPort,
  ) {}

  public async activateConfiguration(
    campaignId: string,
    expectedVersion: number,
  ): Promise<IStoredDiscoveryCampaignConfiguration> {
    validateIdentifier(campaignId, 'campaignId');
    validateVersion(expectedVersion, 'expectedVersion');
    const configuration = await this.configurationRepository.activateConfiguration(
      campaignId,
      expectedVersion,
      this.clock.getCurrentTime(),
    );

    if (configuration === undefined) {
      throw new DiscoveryConfigurationConflictError(
        `Discovery configuration ${campaignId} revision ${expectedVersion} cannot be activated`,
      );
    }

    return configuration;
  }

  public async archiveConfigurations(
    campaignIds: readonly string[],
  ): Promise<IDiscoveryConfigurationArchiveResult> {
    if (campaignIds.length === 0 || new Set(campaignIds).size !== campaignIds.length) {
      throw new Error('campaignIds must be a non-empty array of unique values');
    }
    campaignIds.forEach((campaignId) => validateIdentifier(campaignId, 'campaignIds'));

    const result = await this.configurationRepository.archiveConfigurations(
      campaignIds,
      this.clock.getCurrentTime(),
    );

    if (result.conflicts.length > 0) {
      throw new DiscoveryConfigurationConflictError(
        result.conflicts.map((conflict) => `${conflict.campaignId}: ${conflict.reason}`).join('; '),
      );
    }

    return result;
  }

  public async createConfiguration(
    input: IDiscoveryCampaignConfigurationInput,
  ): Promise<IStoredDiscoveryCampaignConfiguration> {
    const configuration = createConfiguration(input, 1);

    return this.configurationRepository.createDraftConfiguration(
      configuration,
      this.clock.getCurrentTime(),
    );
  }

  public async replaceConfiguration(
    campaignId: string,
    expectedVersion: number,
    input: IDiscoveryCampaignConfigurationInput,
  ): Promise<IStoredDiscoveryCampaignConfiguration> {
    validateIdentifier(campaignId, 'campaignId');
    validateVersion(expectedVersion, 'expectedVersion');

    if (input.campaignId !== campaignId) {
      throw new Error('campaignId must match the route parameter');
    }

    const configuration = createConfiguration(input, expectedVersion + 1);
    const replaced = await this.configurationRepository.replaceDraftConfiguration(
      configuration,
      expectedVersion,
      this.clock.getCurrentTime(),
    );

    if (replaced === undefined) {
      throw new DiscoveryConfigurationNotFoundError(campaignId);
    }

    return replaced;
  }
}

function createConfiguration(
  input: IDiscoveryCampaignConfigurationInput,
  version: number,
): IDiscoveryCampaignConfiguration {
  validateInput(input);
  const stableInput = JSON.stringify({ ...input, version });

  return {
    ...input,
    configurationHash: createHash('sha256').update(stableInput).digest('hex'),
    version,
  };
}

function validateInput(input: IDiscoveryCampaignConfigurationInput): void {
  validateIdentifier(input.campaignId, 'campaignId');

  if (input.searchQueries.length === 0 || input.searchQueries.some((query) => query.trim().length === 0)) {
    throw new Error('searchQueries must contain one or more non-empty values');
  }
  if (input.scopes.length === 0) {
    throw new Error('scopes must contain one or more values');
  }
  if (new Set(input.scopes.map((scope) => scope.id)).size !== input.scopes.length) {
    throw new Error('scope ids must be unique');
  }
  if (input.limits.maxProviderItemsPerRun > input.limits.dailyProviderItemLimit) {
    throw new Error('limits.maxProviderItemsPerRun must not exceed limits.dailyProviderItemLimit');
  }
  if (input.source.actorId.trim().length === 0) {
    throw new Error('source.actorId must be non-empty');
  }
}

function validateIdentifier(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${name} must be non-empty`);
  }
}

function validateVersion(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive safe integer`);
  }
}
