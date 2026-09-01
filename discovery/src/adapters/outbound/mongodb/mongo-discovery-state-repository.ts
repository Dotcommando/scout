import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import {
  DISCOVERY_SCOPE_STATUS,
  DiscoveryCampaignReference,
  DiscoveryScopeProgress,
  IImportProgress,
  IProviderRunReference,
  ITerminalFailureContext,
  PROVIDER_RUN_STATUS,
} from '../../../domain/discovery/discovery-model.js';
import {
  IClaimNextActiveScopeInput,
  IClaimNextEligibleScopeInput,
  IDiscoveryStateRepositoryPort,
  IReleaseScopeClaimInput,
  ISynchronizeConfiguredScopesInput,
} from '../../../ports/outbound/discovery-state-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface IDiscoveryScopeDocument {
  readonly attemptCount: number;
  readonly campaignId: string;
  readonly claimedAt?: Date;
  readonly claimedBy?: string;
  readonly completedAt?: Date;
  readonly configurationHash?: string;
  readonly failureCode?: string;
  readonly failureMessage?: string;
  readonly failureOccurredAt?: Date;
  readonly importedItemCount?: number;
  readonly nextItemOffset?: number;
  readonly priority: number;
  readonly providerDatasetReference?: string;
  readonly reservedProviderItemCount?: number;
  readonly providerRunId?: string;
  readonly providerRunStatus?: PROVIDER_RUN_STATUS;
  readonly scopeId: string;
  readonly status: DISCOVERY_SCOPE_STATUS;
  readonly updatedAt: Date;
}

@Injectable()
export class MongoDiscoveryStateRepository
  implements IDiscoveryStateRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IDiscoveryScopeDocument>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient
      .getDatabase()
      .collection('discovery_scope_states');
  }

  public async claimNextEligibleScope(
    input: IClaimNextEligibleScopeInput,
  ): Promise<DiscoveryScopeProgress | null> {
    const document = await this.collection.findOneAndUpdate(
      {
        campaignId: input.campaignId,
        status: DISCOVERY_SCOPE_STATUS.PENDING,
      },
      {
        $inc: {
          attemptCount: 1,
        },
        $set: {
          claimedAt: input.claimedAt,
          claimedBy: input.workerId,
          status: DISCOVERY_SCOPE_STATUS.RUNNING,
          updatedAt: input.claimedAt,
        },
      },
      {
        returnDocument: 'after',
        sort: {
          priority: 1,
          scopeId: 1,
        },
      },
    );

    return document === null ? null : toDiscoveryScopeProgress(document);
  }

  public async claimNextActiveScope(
    input: IClaimNextActiveScopeInput,
  ): Promise<DiscoveryScopeProgress | null> {
    const document = await this.collection.findOneAndUpdate(
      {
        campaignId: input.campaignId,
        status: {
          $in: [
            DISCOVERY_SCOPE_STATUS.RUNNING,
            DISCOVERY_SCOPE_STATUS.IMPORTING,
          ],
        },
        $or: [
          { claimedBy: { $exists: false } },
          { claimedAt: { $lte: input.staleClaimBefore } },
        ],
      },
      {
        $set: {
          claimedAt: input.claimedAt,
          claimedBy: input.workerId,
          updatedAt: input.claimedAt,
        },
      },
      {
        returnDocument: 'after',
        sort: {
          priority: 1,
          scopeId: 1,
        },
      },
    );

    return document === null ? null : toDiscoveryScopeProgress(document);
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      {
        campaignId: 1,
        scopeId: 1,
      },
      {
        name: 'campaign_scope_unique',
        unique: true,
      },
    );
    await this.collection.createIndex(
      {
        campaignId: 1,
        priority: 1,
        scopeId: 1,
        status: 1,
      },
      {
        name: 'eligible_scope_selection',
      },
    );
  }

  public async releaseScopeClaim(
    input: IReleaseScopeClaimInput,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      {
        campaignId: input.campaignId,
        claimedBy: input.workerId,
        scopeId: input.scopeId,
        status: DISCOVERY_SCOPE_STATUS.RUNNING,
      },
      {
        $set: {
          status: DISCOVERY_SCOPE_STATUS.PENDING,
          updatedAt: input.releasedAt,
        },
        $unset: {
          claimedAt: '',
          claimedBy: '',
        },
      },
    );

    return result.modifiedCount === 1;
  }

  public async findScopeProgress(
    campaignId: string,
    scopeId: string,
  ): Promise<DiscoveryScopeProgress | null> {
    const document = await this.collection.findOne({
      campaignId,
      scopeId,
    });

    return document === null ? null : toDiscoveryScopeProgress(document);
  }

  public async saveScopeProgress(scope: DiscoveryScopeProgress): Promise<void> {
    const document = toDiscoveryScopeDocument(scope);

    await this.collection.updateOne(
      {
        campaignId: document.campaignId,
        scopeId: document.scopeId,
      },
      {
        $set: document,
        $unset: {
          ...(scope.claimedAt === undefined ? { claimedAt: '' } : {}),
          ...(scope.claimedBy === undefined ? { claimedBy: '' } : {}),
          ...(scope.completedAt === undefined ? { completedAt: '' } : {}),
          ...(scope.failure === undefined
            ? {
                failureCode: '',
                failureMessage: '',
                failureOccurredAt: '',
              }
            : {}),
          ...(scope.importProgress === undefined
            ? { importedItemCount: '', nextItemOffset: '' }
            : {}),
          ...(scope.providerRun === undefined
            ? {
                providerDatasetReference: '',
                providerRunId: '',
                providerRunStatus: '',
              }
            : {}),
          ...(scope.reservedProviderItemCount === undefined
            ? { reservedProviderItemCount: '' }
            : {}),
        },
      },
      {
        upsert: true,
      },
    );
  }

  public async synchronizeConfiguredScopes(
    input: ISynchronizeConfiguredScopesInput,
  ): Promise<void> {
    if (input.scopes.length === 0) {
      return;
    }

    await this.collection.bulkWrite(
      input.scopes.map((scope) => ({
        updateOne: {
          filter: {
            campaignId: input.campaignId,
            scopeId: scope.scopeId,
          },
          update: {
            $set: {
              configurationHash: input.configurationHash,
              priority: scope.priority,
              updatedAt: input.synchronizedAt,
            },
            $setOnInsert: {
              attemptCount: 0,
              campaignId: input.campaignId,
              scopeId: scope.scopeId,
              status: DISCOVERY_SCOPE_STATUS.PENDING,
            },
          },
          upsert: true,
        },
      })),
    );
  }
}

function toDiscoveryScopeDocument(
  scope: DiscoveryScopeProgress,
): IDiscoveryScopeDocument {
  return {
    attemptCount: scope.attemptCount,
    campaignId: scope.campaign.campaignId,
    ...(scope.claimedAt === undefined ? {} : { claimedAt: scope.claimedAt }),
    ...(scope.claimedBy === undefined ? {} : { claimedBy: scope.claimedBy }),
    ...(scope.completedAt === undefined
      ? {}
      : { completedAt: scope.completedAt }),
    ...(scope.failure === undefined
      ? {}
      : {
          ...(scope.failure.code === undefined
            ? {}
            : { failureCode: scope.failure.code }),
          failureMessage: scope.failure.message,
          failureOccurredAt: scope.failure.occurredAt,
        }),
    ...(scope.importProgress === undefined
      ? {}
      : {
          importedItemCount: scope.importProgress.importedItemCount,
        nextItemOffset: scope.importProgress.nextItemOffset,
      }),
    ...(scope.reservedProviderItemCount === undefined
      ? {}
      : { reservedProviderItemCount: scope.reservedProviderItemCount }),
    priority: scope.priority,
    ...(scope.providerRun === undefined
      ? {}
      : {
          ...(scope.providerRun.datasetReference === undefined
            ? {}
            : { providerDatasetReference: scope.providerRun.datasetReference }),
          providerRunId: scope.providerRun.providerRunId,
          providerRunStatus: scope.providerRun.status,
        }),
    scopeId: scope.scopeId,
    status: scope.status,
    updatedAt: scope.updatedAt,
  };
}

function toDiscoveryScopeProgress(
  document: IDiscoveryScopeDocument,
): DiscoveryScopeProgress {
  const providerRun = toProviderRunReference(document);
  const importProgress = toImportProgress(document);
  const failure = toTerminalFailureContext(document);

  return new DiscoveryScopeProgress(
    document.attemptCount,
    new DiscoveryCampaignReference(document.campaignId),
    document.priority,
    document.claimedAt,
    document.claimedBy,
    document.completedAt,
    failure,
    importProgress,
    document.reservedProviderItemCount,
    providerRun,
    document.scopeId,
    document.status,
    document.updatedAt,
  );
}

function toImportProgress(
  document: IDiscoveryScopeDocument,
): IImportProgress | undefined {
  if (
    document.importedItemCount === undefined
    || document.nextItemOffset === undefined
  ) {
    return undefined;
  }

  return {
    importedItemCount: document.importedItemCount,
    nextItemOffset: document.nextItemOffset,
  };
}

function toProviderRunReference(
  document: IDiscoveryScopeDocument,
): IProviderRunReference | undefined {
  if (
    document.providerRunId === undefined
    || document.providerRunStatus === undefined
  ) {
    return undefined;
  }

  return {
    ...(document.providerDatasetReference === undefined
      ? {}
      : { datasetReference: document.providerDatasetReference }),
    providerRunId: document.providerRunId,
    status: document.providerRunStatus,
  };
}

function toTerminalFailureContext(
  document: IDiscoveryScopeDocument,
): ITerminalFailureContext | undefined {
  if (
    document.failureMessage === undefined
    || document.failureOccurredAt === undefined
  ) {
    return undefined;
  }

  return {
    ...(document.failureCode === undefined
      ? {}
      : { code: document.failureCode }),
    message: document.failureMessage,
    occurredAt: document.failureOccurredAt,
  };
}
