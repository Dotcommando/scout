import { DISCOVERY_OUTPUT_STATUS } from '../../domain/discovery/discovery-model.js';

export interface IDiscoveryOutputRepositoryPort {
  saveDiscoveryOutput(input: ISaveDiscoveryOutputInput): Promise<void>;
}

export interface ISaveDiscoveryOutputInput {
  readonly campaignId: string;
  readonly createdAt: Date;
  readonly leadId: string;
  readonly outputId: string;
  readonly status: DISCOVERY_OUTPUT_STATUS;
}
