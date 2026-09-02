import { Injectable } from '@nestjs/common';
import {
  IActorGatewayArchiveManifest,
  IActorGatewayRequestStatus,
} from '@scout/contracts';

import { IActorRequestRepositoryPort } from '../../../ports/outbound/actor-request-repository.port.js';

@Injectable()
export class VolatileActorRequestRepository
  implements IActorRequestRepositoryPort {
  private readonly requestStatuses = new Map<string, IActorGatewayRequestStatus>();

  public async findArchiveContent(
    archiveId: string,
  ): Promise<Uint8Array | null> {
    void archiveId;

    return null;
  }

  public async findArchiveManifest(
    archiveId: string,
  ): Promise<IActorGatewayArchiveManifest | null> {
    void archiveId;

    return null;
  }

  public async findRequestStatus(
    requestId: string,
  ): Promise<IActorGatewayRequestStatus | null> {
    return this.requestStatuses.get(requestId) ?? null;
  }

  public async saveRequestStatus(
    status: IActorGatewayRequestStatus,
  ): Promise<void> {
    this.requestStatuses.set(status.requestId, status);
  }
}
