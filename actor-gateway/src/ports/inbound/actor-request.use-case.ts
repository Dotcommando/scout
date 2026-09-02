import {
  IActorGatewayArchiveManifest,
  IActorGatewayRequestStatus,
  IActorGatewayResolveRequest,
} from '@scout/contracts';

export interface IResolveActorRequestUseCase {
  resolveRequest(
    input: IActorGatewayResolveRequest,
  ): Promise<IActorGatewayRequestStatus>;
}

export interface IGetActorRequestStatusUseCase {
  getRequestStatus(
    requestId: string,
  ): Promise<IActorGatewayRequestStatus | null>;
}

export interface IGetArchiveManifestUseCase {
  getArchiveManifest(
    archiveId: string,
  ): Promise<IActorGatewayArchiveManifest | null>;
}

export interface IGetArchiveContentUseCase {
  getArchiveContent(archiveId: string): Promise<Uint8Array | null>;
}
