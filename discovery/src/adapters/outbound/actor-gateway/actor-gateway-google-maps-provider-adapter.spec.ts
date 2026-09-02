import { gzipSync } from 'node:zlib';

import {
  ACTOR_GATEWAY_SCHEMA_VERSION,
  ACTOR_REQUEST_STATUS,
  IActorGatewayArchiveManifest,
  IActorGatewayRequestStatus,
} from '@scout/contracts';

import { IActorGatewayClientPort } from '../../../ports/outbound/actor-gateway-client.port.js';
import { ActorGatewayGoogleMapsProviderAdapter } from './actor-gateway-google-maps-provider-adapter.js';

class FakeActorGatewayClient implements IActorGatewayClientPort {
  public async getArchiveContent(): Promise<Uint8Array> {
    return gzipSync(new TextEncoder().encode(JSON.stringify([
      { placeId: 'place-1', title: 'Example Lead' },
      { type: 'searchMetadata' },
    ])));
  }

  public async getArchiveManifest(): Promise<IActorGatewayArchiveManifest> {
    return {
      archiveId: 'archive-1',
      byteLength: 1,
      contentEncoding: 'gzip',
      contentType: 'application/json',
      requestId: 'request-1',
      runId: 'run-1',
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
      sha256: 'checksum',
      storedAt: '2026-09-02T00:00:00.000Z',
    };
  }

  public async getRequestStatus(): Promise<IActorGatewayRequestStatus> {
    return this.createStatus(ACTOR_REQUEST_STATUS.SUCCEEDED);
  }

  public async resolveRequest(): Promise<IActorGatewayRequestStatus> {
    return this.createStatus(ACTOR_REQUEST_STATUS.SUCCEEDED);
  }

  private createStatus(status: ACTOR_REQUEST_STATUS): IActorGatewayRequestStatus {
    return {
      actorDefinitionId: 'google-maps-search',
      actorRevision: 'latest',
      ...(status === ACTOR_REQUEST_STATUS.SUCCEEDED ? { archiveId: 'archive-1' } : {}),
      correlationId: 'correlation-1',
      createdAt: '2026-09-02T00:00:00.000Z',
      requestId: 'request-1',
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
      status,
      updatedAt: '2026-09-02T00:00:00.000Z',
    };
  }
}

describe('ActorGatewayGoogleMapsProviderAdapter', () => {
  it('normalizes archived Actor Gateway records without a direct provider call', async () => {
    const adapter = new ActorGatewayGoogleMapsProviderAdapter(new FakeActorGatewayClient());
    const run = await adapter.startProviderRun({
      maximumItemCount: 10,
      scopeId: 'GB',
      searchQueries: ['independent hotels'],
    });
    const page = await adapter.readProviderResults({
      datasetReference: run.datasetReference ?? '',
      limit: 25,
      offset: 0,
    });

    expect(run.providerRunId).toBe('request-1');
    expect(page.items).toEqual([{ externalId: 'place-1', name: 'Example Lead' }]);
  });
});
