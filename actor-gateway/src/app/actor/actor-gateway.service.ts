import {
  IActorGatewayArchiveManifest,
  IActorGatewayRequestStatus,
  IActorGatewayResolveRequest,
} from '@scout/contracts';

import { createCanonicalActorRequest } from '../../domain/actor/actor-request.js';
import {
  IGetActorRequestStatusUseCase,
  IGetArchiveContentUseCase,
  IGetArchiveManifestUseCase,
  IResolveActorRequestUseCase,
} from '../../ports/inbound/actor-request.use-case.js';
import { IActorRequestRepositoryPort } from '../../ports/outbound/actor-request-repository.port.js';

export class ActorGatewayService implements
  IGetActorRequestStatusUseCase,
  IGetArchiveContentUseCase,
  IGetArchiveManifestUseCase,
  IResolveActorRequestUseCase {
  public constructor(
    private readonly actorRequestRepository: IActorRequestRepositoryPort,
  ) {}

  public async getArchiveContent(
    archiveId: string,
  ): Promise<Uint8Array | null> {
    return this.actorRequestRepository.findArchiveContent(archiveId);
  }

  public async getArchiveManifest(
    archiveId: string,
  ): Promise<IActorGatewayArchiveManifest | null> {
    return this.actorRequestRepository.findArchiveManifest(archiveId);
  }

  public async getRequestStatus(
    requestId: string,
  ): Promise<IActorGatewayRequestStatus | null> {
    return this.actorRequestRepository.findRequestStatus(requestId);
  }

  public async resolveRequest(
    input: IActorGatewayResolveRequest,
  ): Promise<IActorGatewayRequestStatus> {
    const now = new Date();
    const timestamp = now.toISOString();
    const reusableUntil = new Date(
      now.getTime() + 24 * 60 * 60 * 1000,
    ).toISOString();
    const request = createCanonicalActorRequest(
      crypto.randomUUID(),
      input,
      timestamp,
      reusableUntil,
    );

    return this.actorRequestRepository.findOrCreateRequest(request);
  }
}
