import {
  LIVE_DISCOVERY_EXECUTION_PURPOSE,
  LIVE_DISCOVERY_PAUSE_REASON,
} from '../../domain/discovery/live-discovery-execution-model.js';

export interface ILiveDiscoveryExecutionRepositoryPort {
  pauseExecution(input: IPauseLiveDiscoveryExecutionInput): Promise<void>;
  recordImportedBatch(input: IRecordLiveImportedBatchInput): Promise<ILiveImportedBatchRecord>;
  reserveProviderRun(input: IReserveLiveProviderRunInput): Promise<ILiveProviderRunReservation | null>;
}

export interface IPauseLiveDiscoveryExecutionInput {
  readonly executionId: string;
  readonly pausedAt: Date;
  readonly reason: LIVE_DISCOVERY_PAUSE_REASON;
}

export interface ILiveImportedBatchRecord {
  readonly batchSequence: number;
  readonly cumulativeInsertedLeadCount: number;
  readonly cumulativeProviderItemCount: number;
  readonly paused: boolean;
  readonly uniqueLeadRate: number;
}

export interface IRecordLiveImportedBatchInput {
  readonly batchInsertedLeadCount: number;
  readonly batchProviderItemCount: number;
  readonly executionId: string;
  readonly minimumUniqueLeadRate: number;
  readonly minimumYieldEvaluationProviderItems: number;
  readonly recordedAt: Date;
}

export interface ILiveProviderRunReservation {
  readonly executionId: string;
  readonly maximumItemCount: number;
  readonly planProviderItemCount: number;
  readonly planProviderRunCount: number;
}

export interface IReserveLiveProviderRunInput {
  readonly campaignId: string;
  readonly configurationHash: string;
  readonly executionId: string;
  readonly maximumItemCount: number;
  readonly maximumPlanProviderItems: number;
  readonly maximumPlanProviderRuns: number;
  readonly planId: string;
  readonly purpose: LIVE_DISCOVERY_EXECUTION_PURPOSE;
  readonly reservedAt: Date;
}
