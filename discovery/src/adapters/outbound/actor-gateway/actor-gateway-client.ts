import {
  ACTOR_GATEWAY_API_PATH,
  IActorGatewayArchiveManifest,
  IActorGatewayRequestStatus,
  IActorGatewayResolveRequest,
  parseActorGatewayArchiveManifest,
  parseActorGatewayRequestStatus,
} from '@scout/contracts';

import { IActorGatewayClientPort } from '../../../ports/outbound/actor-gateway-client.port.js';
import { DiscoveryRuntimeConfiguration } from '../../inbound/bootstrap/discovery-runtime-configuration.js';

export class ActorGatewayClient implements IActorGatewayClientPort {
  private readonly baseUrl: string;

  public constructor(runtimeConfiguration: DiscoveryRuntimeConfiguration) {
    this.baseUrl = runtimeConfiguration.actorGatewayUrl;
  }

  public async getArchiveContent(archiveId: string): Promise<Uint8Array> {
    const response = await this.fetch(`/archives/${encodeURIComponent(archiveId)}/content`);

    return new Uint8Array(await response.arrayBuffer());
  }

  public async getArchiveManifest(
    archiveId: string,
  ): Promise<IActorGatewayArchiveManifest> {
    return parseActorGatewayArchiveManifest(
      await this.readJson(`/archives/${encodeURIComponent(archiveId)}`),
    );
  }

  public async getRequestStatus(
    requestId: string,
  ): Promise<IActorGatewayRequestStatus> {
    return parseActorGatewayRequestStatus(
      await this.readJson(`/${encodeURIComponent(requestId)}`),
    );
  }

  public async resolveRequest(
    request: IActorGatewayResolveRequest,
  ): Promise<IActorGatewayRequestStatus> {
    const response = await fetch(this.createUrl(''), {
      body: JSON.stringify(request),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    });

    return parseActorGatewayRequestStatus(await this.readResponseJson(response));
  }

  private createUrl(path: string): string {
    return `${this.baseUrl}${ACTOR_GATEWAY_API_PATH}${path}`;
  }

  private async fetch(path: string): Promise<Response> {
    const response = await fetch(this.createUrl(path));

    if (!response.ok) {
      throw new ActorGatewayClientError(response.status, path);
    }

    return response;
  }

  private async readJson(path: string): Promise<unknown> {
    return this.readResponseJson(await this.fetch(path));
  }

  private async readResponseJson(response: Response): Promise<unknown> {
    if (!response.ok) {
      throw new ActorGatewayClientError(response.status, response.url);
    }

    return response.json();
  }
}

export class ActorGatewayClientError extends Error {
  public constructor(
    public readonly statusCode: number,
    path: string,
  ) {
    super(`Actor Gateway request failed with HTTP ${statusCode}: ${path}`);
    this.name = 'ActorGatewayClientError';
  }
}
