import {
  IActorGatewayArchiveManifest,
  IActorGatewayRequestStatus,
} from '@scout/contracts';

export interface IActorRequestRepositoryPort {
  findArchiveContent(archiveId: string): Promise<Uint8Array | null>;
  findArchiveManifest(
    archiveId: string,
  ): Promise<IActorGatewayArchiveManifest | null>;
  findRequestStatus(
    requestId: string,
  ): Promise<IActorGatewayRequestStatus | null>;
  saveRequestStatus(status: IActorGatewayRequestStatus): Promise<void>;
}
