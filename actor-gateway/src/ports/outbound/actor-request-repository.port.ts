import {
  IActorGatewayArchiveManifest,
  IActorGatewayRequestStatus,
  IActorGatewayResolveRequest,
} from '@scout/contracts';

import { ICanonicalActorRequest } from '../../domain/actor/actor-request.js';

export interface IActorArchiveRecord {
  readonly actorDefinitionId: string;
  readonly actorRevision: string;
  readonly archiveId: string;
  readonly content: Uint8Array;
  readonly contentType: string;
  readonly recordBoundaryIndex: readonly number[];
  readonly requestId: string;
  readonly runId: string;
  readonly storedAt: string;
}

export enum ACTOR_EXECUTION_CLAIM_OUTCOME {
  CLAIMED = 'CLAIMED',
  IN_PROGRESS = 'IN_PROGRESS',
  TERMINAL = 'TERMINAL',
  UNKNOWN_START_OUTCOME = 'UNKNOWN_START_OUTCOME',
}

export interface IActorExecutionClaim {
  readonly attempt: number;
  readonly outcome: ACTOR_EXECUTION_CLAIM_OUTCOME;
  readonly providerRunId?: string;
  readonly status: IActorGatewayRequestStatus;
}

export interface IObservedActorField {
  readonly actorDefinitionId: string;
  readonly actorRevision: string;
  readonly firstObservedArchiveId: string;
  readonly jsonPointer: string;
  readonly lastObservedArchiveId: string;
  readonly lastObservedAt: string;
  readonly nonNullRecordCount: number;
  readonly observedValueKinds: readonly string[];
  readonly presentRecordCount: number;
  readonly recordKind: string;
}

export interface IActorRequestRepositoryPort {
  claimExecution(
    requestId: string,
    claimedAt: string,
    staleBefore: string,
  ): Promise<IActorExecutionClaim>;
  findArchiveContent(archiveId: string): Promise<Uint8Array | null>;
  findArchiveManifest(
    archiveId: string,
  ): Promise<IActorGatewayArchiveManifest | null>;
  findRequestStatus(
    requestId: string,
  ): Promise<IActorGatewayRequestStatus | null>;
  findRequestExecutionInput(
    requestId: string,
  ): Promise<IActorGatewayResolveRequest | null>;
  findObservedFields(
    actorDefinitionId: string,
    pathFragment: string,
  ): Promise<readonly IObservedActorField[]>;
  findOrCreateRequest(
    request: ICanonicalActorRequest,
  ): Promise<IActorGatewayRequestStatus>;
  markRequestSucceeded(
    requestId: string,
    archiveId: string,
    updatedAt: string,
  ): Promise<IActorGatewayRequestStatus>;
  markRequestFailed(
    requestId: string,
    updatedAt: string,
  ): Promise<IActorGatewayRequestStatus>;
  recordProviderRun(
    requestId: string,
    providerRunId: string,
    updatedAt: string,
  ): Promise<IActorGatewayRequestStatus>;
  saveArchive(archive: IActorArchiveRecord): Promise<IActorGatewayArchiveManifest>;
}
