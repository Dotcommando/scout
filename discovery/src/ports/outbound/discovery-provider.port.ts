import {
  IProviderRunReference,
} from '../../domain/discovery/discovery-model.js';

export interface IDiscoveryProviderPort {
  getRunStatus(input: IGetProviderRunStatusInput): Promise<IProviderRunReference>;
  readProviderResults(input: IReadProviderResultsInput): Promise<IProviderResultPage>;
  startProviderRun(input: IStartProviderRunInput): Promise<IProviderRunReference>;
}

export interface IGetProviderRunStatusInput {
  readonly providerRunId: string;
}

export interface IProviderResultPage {
  readonly items: readonly IProviderLeadCandidate[];
  readonly nextOffset: number | null;
}

export interface IProviderLeadCandidate {
  readonly externalId: string;
  readonly name: string;
}

export interface IReadProviderResultsInput {
  readonly datasetReference: string;
  readonly limit: number;
  readonly offset: number;
}

export interface IStartProviderRunInput {
  readonly maximumItemCount: number;
  readonly scopeId: string;
  readonly searchQueries: readonly string[];
}
