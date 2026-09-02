import { IDiscoveryOutputPayload } from '../../app/discovery/discovery-output-payload.js';
import { DISCOVERY_OUTPUT_STATUS } from '../../domain/discovery/discovery-model.js';

export interface IDiscoveryOutputRepositoryPort {
  claimPendingDiscoveryOutputs(
    input: IClaimPendingDiscoveryOutputsInput,
  ): Promise<readonly IClaimedDiscoveryOutput[]>;
  confirmDiscoveryOutputPublication(
    input: IConfirmDiscoveryOutputPublicationInput,
  ): Promise<boolean>;
  recordDiscoveryOutputPublicationFailure(
    input: IRecordDiscoveryOutputPublicationFailureInput,
  ): Promise<boolean>;
  releaseDiscoveryOutputClaim(
    input: IReleaseDiscoveryOutputClaimInput,
  ): Promise<boolean>;
  saveDiscoveryOutput(
    input: ISaveDiscoveryOutputInput,
  ): Promise<DISCOVERY_OUTPUT_SAVE_OUTCOME>;
}

export enum DISCOVERY_OUTPUT_SAVE_OUTCOME {
  EXISTING = 'existing',
  INSERTED = 'inserted',
}

export enum DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND {
  CONFIRMATION = 'confirmation',
  CONNECTION = 'connection',
  INVALID_PAYLOAD = 'invalid-payload',
  MANDATORY_ROUTING = 'mandatory-routing',
  UNKNOWN = 'unknown',
}

export interface IClaimPendingDiscoveryOutputsInput {
  readonly claimedAt: Date;
  readonly leaseExpiresAt: Date;
  readonly limit: number;
  readonly retryEligibleAt: Date;
  readonly workerId: string;
}

export interface IClaimedDiscoveryOutput {
  readonly campaignId: string;
  readonly leadId: string;
  readonly outputId: string;
  readonly payload?: IDiscoveryOutputPayload;
  readonly publishAttemptCount: number;
}

export interface IConfirmDiscoveryOutputPublicationInput {
  readonly confirmedAt: Date;
  readonly outputId: string;
  readonly workerId: string;
}

export interface IDiscoveryOutputPublicationFailure {
  readonly kind: DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND;
  readonly message: string;
  readonly occurredAt: Date;
  readonly retryable: boolean;
}

export interface IRecordDiscoveryOutputPublicationFailureInput {
  readonly failure: IDiscoveryOutputPublicationFailure;
  readonly nextAttemptAt: Date;
  readonly outputId: string;
  readonly workerId: string;
}

export interface IReleaseDiscoveryOutputClaimInput {
  readonly outputId: string;
  readonly releasedAt: Date;
  readonly workerId: string;
}

export interface ISaveDiscoveryOutputInput {
  readonly campaignId: string;
  readonly createdAt: Date;
  readonly leadId: string;
  readonly outputId: string;
  readonly payload: IDiscoveryOutputPayload;
  readonly status: DISCOVERY_OUTPUT_STATUS;
}
