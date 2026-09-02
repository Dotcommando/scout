import { createHash } from 'node:crypto';

import {
  DISCOVERY_OUTPUT_STATUS,
  DISCOVERY_SCOPE_STATUS,
  DISCOVERY_SOURCE_KIND,
  DiscoveryScopeProgress,
  Lead,
  LeadSourceIdentity,
  PROVIDER_RUN_STATUS,
} from '../../domain/discovery/discovery-model.js';
import { IClockPort } from '../../ports/outbound/clock.port.js';
import {
  IDiscoveryCampaignConfigurationPort,
} from '../../ports/outbound/discovery-campaign-configuration.port.js';
import {
  IDiscoveryOutputRepositoryPort,
} from '../../ports/outbound/discovery-output-repository.port.js';
import {
  DiscoveryProviderError,
  IDiscoveryProviderPort,
  IProviderLeadCandidate,
} from '../../ports/outbound/discovery-provider.port.js';
import {
  IDiscoveryStateRepositoryPort,
} from '../../ports/outbound/discovery-state-repository.port.js';
import {
  ILeadRepositoryPort,
  LEAD_UPSERT_OUTCOME,
} from '../../ports/outbound/lead-repository.port.js';
import {
  IProviderQuotaRepositoryPort,
} from '../../ports/outbound/provider-quota-repository.port.js';
import {
  IDiscoveryCampaignConfiguration,
} from './discovery-campaign-configuration.js';
import { createDiscoveryOutputPayload } from './discovery-output-payload.js';

const DISCOVERY_SCOPE_CLAIM_STALE_MILLISECONDS = 5 * 60 * 1000;
const PROVIDER_RESULT_PAGE_SIZE = 25;

export enum DISCOVERY_WORK_OUTCOME {
  BUDGET_EXHAUSTED = 'budget-exhausted',
  IDLE = 'idle',
  IMPORT_COMPLETED = 'import-completed',
  IMPORT_PROGRESS_SAVED = 'import-progress-saved',
  PROVIDER_RUN_PENDING = 'provider-run-pending',
  PROVIDER_RUN_STARTED = 'provider-run-started',
  TERMINAL_PROVIDER_FAILURE = 'terminal-provider-failure',
}

export interface IAdvanceDiscoveryWorkInput {
  readonly correlationId: string;
  readonly workerId: string;
}

export interface IAdvanceDiscoveryWorkResult {
  readonly outcome: DISCOVERY_WORK_OUTCOME;
  readonly reservedItemCount?: number;
  readonly scopeId?: string;
}

export interface IDiscoveryWorkFailureContext {
  readonly attempt?: number;
  readonly campaignId: string;
  readonly providerRunId?: string;
  readonly scopeId?: string;
  readonly sourceKind: DISCOVERY_SOURCE_KIND;
}

export class DiscoveryWorkError extends Error {
  public constructor(
    public readonly context: IDiscoveryWorkFailureContext,
    public readonly retryable: boolean,
    cause: unknown,
  ) {
    super('Discovery work failed', { cause });
    this.name = 'DiscoveryWorkError';
  }
}

export interface IDiscoveryWorkUseCase {
  advanceDiscoveryWork(
    input: IAdvanceDiscoveryWorkInput,
  ): Promise<IAdvanceDiscoveryWorkResult>;
}

export class DiscoveryProgressService implements IDiscoveryWorkUseCase {
  public constructor(
    private readonly campaignConfiguration: IDiscoveryCampaignConfigurationPort,
    private readonly clock: IClockPort,
    private readonly discoveryOutputRepository: IDiscoveryOutputRepositoryPort,
    private readonly discoveryProvider: IDiscoveryProviderPort,
    private readonly leadRepository: ILeadRepositoryPort,
    private readonly scopeRepository: IDiscoveryStateRepositoryPort,
    private readonly quotaRepository: IProviderQuotaRepositoryPort,
  ) {}

  public async advanceDiscoveryWork(
    input: IAdvanceDiscoveryWorkInput,
  ): Promise<IAdvanceDiscoveryWorkResult> {
    try {
      return await this.advanceDiscoveryWorkInternal(input);
    } catch (error: unknown) {
      if (error instanceof DiscoveryWorkError) {
        throw error;
      }

      const configuration = this.campaignConfiguration.getCampaignConfiguration();

      throw new DiscoveryWorkError(
        {
          campaignId: configuration.campaignId,
          sourceKind: configuration.source.kind,
        },
        true,
        error,
      );
    }
  }

  private async advanceDiscoveryWorkInternal(
    input: IAdvanceDiscoveryWorkInput,
  ): Promise<IAdvanceDiscoveryWorkResult> {
    const configuration = this.campaignConfiguration.getCampaignConfiguration();
    const currentTime = this.clock.getCurrentTime();

    await this.scopeRepository.synchronizeConfiguredScopes({
      campaignId: configuration.campaignId,
      configurationHash: configuration.configurationHash,
      scopes: configuration.scopes.map((scope) => ({
        priority: scope.priority,
        scopeId: scope.id,
      })),
      synchronizedAt: currentTime,
    });

    const activeScope = await this.scopeRepository.claimNextActiveScope({
      campaignId: configuration.campaignId,
      claimedAt: currentTime,
      staleClaimBefore: new Date(
        currentTime.getTime() - DISCOVERY_SCOPE_CLAIM_STALE_MILLISECONDS,
      ),
      workerId: input.workerId,
    });

    if (activeScope !== null) {
      return this.processActiveScope(
        activeScope,
        configuration,
        currentTime,
        input.correlationId,
      );
    }

    const scope = await this.scopeRepository.claimNextEligibleScope({
      campaignId: configuration.campaignId,
      claimedAt: currentTime,
      workerId: input.workerId,
    });

    if (scope === null) {
      return { outcome: DISCOVERY_WORK_OUTCOME.IDLE };
    }

    const reservedScope = await this.reserveProviderItems(
      scope,
      configuration.limits.dailyProviderItemLimit,
      configuration.limits.maxProviderItemsPerRun,
      currentTime,
    );

    if (reservedScope === null) {
      const released = await this.scopeRepository.releaseScopeClaim({
        campaignId: configuration.campaignId,
        releasedAt: currentTime,
        scopeId: scope.scopeId,
        workerId: input.workerId,
      });

      if (!released) {
        throw new Error('claimed scope could not be released after quota exhaustion');
      }

      return { outcome: DISCOVERY_WORK_OUTCOME.BUDGET_EXHAUSTED };
    }

    return this.startProviderRun(
      reservedScope,
      configuration.searchQueries,
      currentTime,
    );
  }

  private async failScope(
    scope: DiscoveryScopeProgress,
    code: string,
    message: string,
    currentTime: Date,
  ): Promise<IAdvanceDiscoveryWorkResult> {
    await this.scopeRepository.saveScopeProgress(
      scope
        .fail({ code, message, occurredAt: currentTime }, currentTime)
        .releaseClaim(currentTime),
    );

    return {
      outcome: DISCOVERY_WORK_OUTCOME.TERMINAL_PROVIDER_FAILURE,
      scopeId: scope.scopeId,
    };
  }

  private async importProviderResults(
    scope: DiscoveryScopeProgress,
    currentTime: Date,
    correlationId: string,
  ): Promise<IAdvanceDiscoveryWorkResult> {
    const datasetReference = scope.providerRun?.datasetReference;

    if (datasetReference === undefined) {
      return this.failScope(
        scope,
        'provider-dataset-reference-missing',
        'completed provider run did not provide a dataset reference',
        currentTime,
      );
    }

    const importProgress = scope.importProgress ?? {
      importedItemCount: 0,
      nextItemOffset: 0,
    };
    const page = await this.discoveryProvider.readProviderResults({
      datasetReference,
      limit: PROVIDER_RESULT_PAGE_SIZE,
      offset: importProgress.nextItemOffset,
    });

    for (const candidate of page.items) {
      await this.saveCandidateLead(scope, candidate, currentTime, correlationId);
    }

    const nextItemOffset = importProgress.nextItemOffset + page.items.length;
    const updatedScope = scope
      .recordImportProgress(
        {
          importedItemCount: importProgress.importedItemCount + page.items.length,
          nextItemOffset,
        },
        currentTime,
      )
      .releaseClaim(currentTime);

    if (page.nextOffset === null) {
      await this.scopeRepository.saveScopeProgress(updatedScope.complete(currentTime));

      return {
        outcome: DISCOVERY_WORK_OUTCOME.IMPORT_COMPLETED,
        scopeId: scope.scopeId,
      };
    }

    await this.scopeRepository.saveScopeProgress(updatedScope);

    return {
      outcome: DISCOVERY_WORK_OUTCOME.IMPORT_PROGRESS_SAVED,
      scopeId: scope.scopeId,
    };
  }

  private async processActiveScope(
    scope: DiscoveryScopeProgress,
    configuration: IDiscoveryCampaignConfiguration,
    currentTime: Date,
    correlationId: string,
  ): Promise<IAdvanceDiscoveryWorkResult> {
    try {
      if (scope.status === DISCOVERY_SCOPE_STATUS.IMPORTING) {
        return await this.importProviderResults(scope, currentTime, correlationId);
      }
      if (scope.providerRun === undefined) {
        const reservedScope = await this.reserveProviderItems(
          scope,
          configuration.limits.dailyProviderItemLimit,
          configuration.limits.maxProviderItemsPerRun,
          currentTime,
        );

        if (reservedScope === null) {
          return this.failScope(
            scope,
            'provider-quota-reservation-missing',
            'active scope could not obtain a provider quota reservation',
            currentTime,
          );
        }

        return this.startProviderRun(
          reservedScope,
          configuration.searchQueries,
          currentTime,
        );
      }

      const providerRun = await this.discoveryProvider.getRunStatus({
        providerRunId: scope.providerRun.providerRunId,
      });
      const updatedScope = scope.recordProviderRun(providerRun, currentTime);

      if (providerRun.status === PROVIDER_RUN_STATUS.FAILED) {
        return this.failScope(
          updatedScope,
          'provider-run-failed',
          'provider run reached a terminal failure state',
          currentTime,
        );
      }
      if (providerRun.status !== PROVIDER_RUN_STATUS.SUCCEEDED) {
        await this.scopeRepository.saveScopeProgress(
          updatedScope.releaseClaim(currentTime),
        );

        return {
          outcome: DISCOVERY_WORK_OUTCOME.PROVIDER_RUN_PENDING,
          scopeId: scope.scopeId,
        };
      }
      if (providerRun.datasetReference === undefined) {
        return this.failScope(
          updatedScope,
          'provider-dataset-reference-missing',
          'completed provider run did not provide a dataset reference',
          currentTime,
        );
      }

      return await this.importProviderResults(
        updatedScope.startImport(currentTime),
        currentTime,
        correlationId,
      );
    } catch (error: unknown) {
      await this.scopeRepository.saveScopeProgress(scope.releaseClaim(currentTime));

      if (error instanceof DiscoveryProviderError && !error.retryable) {
        return this.failScope(
          scope,
          'provider-operation-failed',
          error.message,
          currentTime,
        );
      }

      throw this.createDiscoveryWorkError(scope, error);
    }
  }

  private async reserveProviderItems(
    scope: DiscoveryScopeProgress,
    dailyItemLimit: number,
    requestedItemCount: number,
    currentTime: Date,
  ): Promise<DiscoveryScopeProgress | null> {
    if (scope.reservedProviderItemCount !== undefined) {
      return scope;
    }

    const reservation = await this.quotaRepository.reserveDailyQuota({
      campaignId: scope.campaign.campaignId,
      dailyItemLimit,
      quotaDay: getUtcQuotaDay(currentTime),
      requestedItemCount,
    });

    if (reservation === null) {
      return null;
    }

    const reservedScope = scope.reserveProviderItems(
      reservation.reservedItemCount,
      currentTime,
    );

    await this.scopeRepository.saveScopeProgress(reservedScope);

    return reservedScope;
  }

  private async saveCandidateLead(
    scope: DiscoveryScopeProgress,
    candidate: IProviderLeadCandidate,
    currentTime: Date,
    correlationId: string,
  ): Promise<void> {
    const sourceIdentity = new LeadSourceIdentity(
      candidate.externalId,
      DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
    );
    const leadId = createStableIdentifier(
      'lead',
      sourceIdentity.sourceKind,
      sourceIdentity.externalId,
    );
    const lead = new Lead(
      currentTime,
      {
        ...(candidate.address === undefined ? {} : { address: candidate.address }),
        name: candidate.name,
        ...(candidate.phoneNumber === undefined
          ? {}
          : { phoneNumber: candidate.phoneNumber }),
        ...(candidate.websiteUrl === undefined
          ? {}
          : { websiteUrl: candidate.websiteUrl }),
      },
      leadId,
      sourceIdentity,
      currentTime,
    );
    const result = await this.leadRepository.upsertLead(lead);

    if (result.outcome === LEAD_UPSERT_OUTCOME.EXISTING) {
      return;
    }

    const outputId = createStableIdentifier(
      'discovery-output',
      scope.campaign.campaignId,
      result.leadId,
    );

    await this.discoveryOutputRepository.saveDiscoveryOutput({
      campaignId: scope.campaign.campaignId,
      createdAt: currentTime,
      leadId: result.leadId,
      outputId,
      payload: createDiscoveryOutputPayload({
        campaignId: scope.campaign.campaignId,
        correlationId,
        lead,
        occurredAt: currentTime,
        outputId,
      }),
      status: DISCOVERY_OUTPUT_STATUS.PENDING,
    });
  }

  private async startProviderRun(
    scope: DiscoveryScopeProgress,
    searchQueries: readonly string[],
    currentTime: Date,
  ): Promise<IAdvanceDiscoveryWorkResult> {
    const maximumItemCount = scope.reservedProviderItemCount;

    if (maximumItemCount === undefined) {
      throw new Error('provider run cannot start without a persisted quota reservation');
    }

    try {
      const providerRun = await this.discoveryProvider.startProviderRun({
        maximumItemCount,
        scopeId: scope.scopeId,
        searchQueries,
      });

      await this.scopeRepository.saveScopeProgress(
        scope.recordProviderRun(providerRun, currentTime).releaseClaim(currentTime),
      );
    } catch (error: unknown) {
      throw this.createDiscoveryWorkError(scope, error);
    }

    return {
      outcome: DISCOVERY_WORK_OUTCOME.PROVIDER_RUN_STARTED,
      reservedItemCount: maximumItemCount,
      scopeId: scope.scopeId,
    };
  }

  private createDiscoveryWorkError(
    scope: DiscoveryScopeProgress,
    error: unknown,
  ): DiscoveryWorkError {
    return new DiscoveryWorkError(
      {
        attempt: scope.attemptCount,
        campaignId: scope.campaign.campaignId,
        ...(scope.providerRun === undefined
          ? {}
          : { providerRunId: scope.providerRun.providerRunId }),
        scopeId: scope.scopeId,
        sourceKind: DISCOVERY_SOURCE_KIND.GOOGLE_MAPS,
      },
      error instanceof DiscoveryProviderError ? error.retryable : true,
      error,
    );
  }
}

function createStableIdentifier(prefix: string, ...parts: readonly string[]): string {
  const hash = createHash('sha256').update(parts.join('\u0000')).digest('hex');

  return `${prefix}-${hash}`;
}

function getUtcQuotaDay(currentTime: Date): string {
  return currentTime.toISOString().slice(0, 10);
}
