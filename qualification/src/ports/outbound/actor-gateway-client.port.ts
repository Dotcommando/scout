import {
  IActorGatewayArchiveManifest,
  IActorGatewayRequestStatus,
  IActorGatewayResolveRequest,
} from '@scout/contracts';

export interface IActorGatewayClientPort {
  getArchiveContent(archiveId: string): Promise<Uint8Array>;
  getArchiveManifest(archiveId: string): Promise<IActorGatewayArchiveManifest>;
  getRequestStatus(requestId: string): Promise<IActorGatewayRequestStatus>;
  resolveRequest(
    request: IActorGatewayResolveRequest,
  ): Promise<IActorGatewayRequestStatus>;
}
