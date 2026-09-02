import {
  DISCOVERY_BACKFILL_RUN_STATUS,
  DISCOVERY_SOURCE_KIND,
} from '../../domain/discovery/discovery-model.js';

export interface IDiscoveryBackfillRunRepositoryPort {
  completeBackfillRun(input: ICompleteDiscoveryBackfillRunInput): Promise<void>;
  failBackfillRun(input: IFailDiscoveryBackfillRunInput): Promise<void>;
  findBackfillRun(runId: string): Promise<IDiscoveryBackfillRun | undefined>;
  startBackfillRun(input: IStartDiscoveryBackfillRunInput): Promise<IDiscoveryBackfillRun>;
}

export interface IDiscoveryBackfillRun {
  readonly campaignId: string;
  readonly completedAt?: Date;
  readonly configurationHash: string;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly dryRun: boolean;
  readonly failureMessage?: string;
  readonly maximumLeadCount: number;
  readonly leadIdPrefix?: string;
  readonly qualificationCatalogRevision: string;
  readonly runId: string;
  readonly selectedSourceKind: DISCOVERY_SOURCE_KIND;
  readonly status: DISCOVERY_BACKFILL_RUN_STATUS;
  readonly totalExistingOutputCount: number;
  readonly totalInsertedOutputCount: number;
  readonly totalSelectedLeadCount: number;
  readonly updatedAt: Date;
}

export interface IStartDiscoveryBackfillRunInput {
  readonly campaignId: string;
  readonly configurationHash: string;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly dryRun: boolean;
  readonly maximumLeadCount: number;
  readonly leadIdPrefix?: string;
  readonly qualificationCatalogRevision: string;
  readonly runId: string;
  readonly selectedSourceKind: DISCOVERY_SOURCE_KIND;
}

export interface ICompleteDiscoveryBackfillRunInput {
  readonly completedAt: Date;
  readonly runId: string;
  readonly totalExistingOutputCount: number;
  readonly totalInsertedOutputCount: number;
  readonly totalSelectedLeadCount: number;
}

export interface IFailDiscoveryBackfillRunInput {
  readonly failedAt: Date;
  readonly failureMessage: string;
  readonly runId: string;
}
