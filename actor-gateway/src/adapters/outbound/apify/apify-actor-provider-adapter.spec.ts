import {
  ACTOR_PROVIDER_RUN_STATUS,
} from '../../../ports/outbound/actor-provider.port.js';
import {
  ApifyActorProviderContractError,
  parseApifyRun,
} from './apify-actor-provider-adapter.js';

describe('ApifyActorProviderAdapter contract parsing', () => {
  it('maps a sanitized completed run to the provider-neutral result', () => {
    expect(parseApifyRun({
      defaultDatasetId: 'dataset-1',
      id: 'run-1',
      status: 'SUCCEEDED',
    })).toEqual({
      datasetId: 'dataset-1',
      providerRunId: 'run-1',
      status: ACTOR_PROVIDER_RUN_STATUS.SUCCEEDED,
    });
  });

  it('rejects malformed provider responses', () => {
    expect(() => parseApifyRun({ status: 'RUNNING' })).toThrow(
      ApifyActorProviderContractError,
    );
  });
});
