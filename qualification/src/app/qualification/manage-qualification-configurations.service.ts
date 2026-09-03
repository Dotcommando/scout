import { IManageQualificationConfigurationsUseCase } from '../../ports/inbound/manage-qualification-configurations.use-case.js';
import { IClockPort } from '../../ports/outbound/clock.port.js';
import { IKnownAffiliationCatalogConfigurationPort } from '../../ports/outbound/known-affiliation-catalog-configuration.port.js';
import {
  IQualificationConfigurationArchiveResult,
  IQualificationConfigurationRepositoryPort,
} from '../../ports/outbound/qualification-configuration-repository.port.js';
import { IQualificationConfigurationRuntimePort } from '../../ports/outbound/qualification-configuration-runtime.port.js';
import {
  createQualificationConfiguration,
  IQualificationConfigurationInput,
  IStoredQualificationConfiguration,
} from './qualification-configuration.js';

export class QualificationConfigurationConflictError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = 'QualificationConfigurationConflictError';
  }
}

export class QualificationConfigurationNotFoundError extends Error {
  public constructor(campaignId: string) {
    super(`Qualification configuration ${campaignId} was not found`);
    this.name = 'QualificationConfigurationNotFoundError';
  }
}

export class ManageQualificationConfigurationsService implements IManageQualificationConfigurationsUseCase {
  public constructor(
    private readonly clock: IClockPort,
    private readonly catalogConfiguration: IKnownAffiliationCatalogConfigurationPort,
    private readonly configurationRepository: IQualificationConfigurationRepositoryPort,
    private readonly configurationRuntime: IQualificationConfigurationRuntimePort,
  ) {}

  public async activateConfiguration(campaignId: string, expectedVersion: number): Promise<IStoredQualificationConfiguration> {
    const configuration = await this.configurationRepository.activateConfiguration(
      campaignId,
      expectedVersion,
      this.clock.getCurrentTime(),
    );

    if (configuration === undefined) {
      throw new QualificationConfigurationConflictError(
        `Qualification configuration ${campaignId} revision ${expectedVersion} cannot be activated`,
      );
    }

    this.configurationRuntime.activateConfiguration(configuration);

    return configuration;
  }

  public async archiveConfigurations(campaignIds: readonly string[]): Promise<IQualificationConfigurationArchiveResult> {
    if (campaignIds.length === 0 || new Set(campaignIds).size !== campaignIds.length) {
      throw new Error('campaignIds must be a non-empty array of unique values');
    }

    const result = await this.configurationRepository.archiveConfigurations(campaignIds, this.clock.getCurrentTime());

    if (result.conflicts.length > 0) {
      throw new QualificationConfigurationConflictError(
        result.conflicts.map((item) => `${item.campaignId}: ${item.reason}`).join('; '),
      );
    }

    return result;
  }

  public async createConfiguration(input: IQualificationConfigurationInput): Promise<IStoredQualificationConfiguration> {
    this.validateCatalogRevision(input.catalogRevision);

    return this.configurationRepository.createDraftConfiguration(
      createQualificationConfiguration(input, 1, this.catalogConfiguration.getCatalog()),
      this.clock.getCurrentTime(),
    );
  }

  public async replaceConfiguration(campaignId: string, expectedVersion: number, input: IQualificationConfigurationInput): Promise<IStoredQualificationConfiguration> {
    if (campaignId !== input.campaignId) {
      throw new Error('campaignId must match the route parameter');
    }
    this.validateCatalogRevision(input.catalogRevision);
    const configuration = await this.configurationRepository.replaceDraftConfiguration(
      createQualificationConfiguration(input, expectedVersion + 1, this.catalogConfiguration.getCatalog()),
      expectedVersion,
      this.clock.getCurrentTime(),
    );

    if (configuration === undefined) {
      throw new QualificationConfigurationNotFoundError(campaignId);
    }

    return configuration;
  }

  private validateCatalogRevision(catalogRevision: string): void {
    if (catalogRevision !== this.catalogConfiguration.getCatalog().revision) {
      throw new Error(`catalogRevision ${catalogRevision} is not the seed-only active catalogue revision`);
    }
  }
}
