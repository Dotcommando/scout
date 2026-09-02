import { DISCOVERY_SOURCE_KIND } from '../../domain/discovery/discovery-model.js';

export interface IRunDiscoveryBackfillUseCase {
  runBackfill(input: IRunDiscoveryBackfillInput): Promise<IDiscoveryBackfillResult>;
}

export interface IRunDiscoveryBackfillInput {
  readonly campaignId: string;
  readonly confirmed: boolean;
  readonly correlationId: string;
  readonly dryRun: boolean;
  readonly leadIdPrefix?: string;
  readonly maximumLeadCount: number;
  readonly qualificationCatalogRevision: string;
  readonly runId: string;
  readonly sourceKind: DISCOVERY_SOURCE_KIND;
}

export interface IDiscoveryBackfillResult {
  readonly existingOutputCount: number;
  readonly insertedOutputCount: number;
  readonly runId: string;
  readonly selectedLeadCount: number;
}
