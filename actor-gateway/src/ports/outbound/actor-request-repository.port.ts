import {
  IActorGatewayArchiveManifest,
  IActorGatewayRequestStatus,
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
  findArchiveContent(archiveId: string): Promise<Uint8Array | null>;
  findArchiveManifest(
    archiveId: string,
  ): Promise<IActorGatewayArchiveManifest | null>;
  findRequestStatus(
    requestId: string,
  ): Promise<IActorGatewayRequestStatus | null>;
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
  saveArchive(archive: IActorArchiveRecord): Promise<IActorGatewayArchiveManifest>;
}
