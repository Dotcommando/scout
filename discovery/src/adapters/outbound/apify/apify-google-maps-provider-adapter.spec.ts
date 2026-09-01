import { readFileSync } from 'node:fs';

import { PROVIDER_RUN_STATUS } from '../../../domain/discovery/discovery-model.js';
import {
  ApifyProviderContractError,
  parseProviderItem,
  parseRun,
} from './apify-google-maps-provider-adapter.js';

const CONTRACT_FIXTURE_PATH = new URL(
  '../../../../test/fixtures/apify-google-maps-contract.json',
  import.meta.url,
);

interface IContractFixture {
  readonly datasetItem: unknown;
  readonly run: unknown;
}

describe('ApifyGoogleMapsProviderAdapter contract parsing', () => {
  it('normalizes the sanitized offline provider fixture', () => {
    const fixture = loadContractFixture();

    expect(parseRun(fixture.run)).toEqual({
      datasetReference: 'sanitized-dataset-id',
      providerRunId: 'sanitized-provider-run-id',
      status: PROVIDER_RUN_STATUS.SUCCEEDED,
    });
    expect(parseProviderItem(fixture.datasetItem)).toEqual({
      address: '1 Example Street, Example City, United Kingdom',
      externalId: 'sanitized-place-id',
      name: 'Sanitized Example Lead',
      phoneNumber: '+44 20 0000 0000',
      websiteUrl: 'https://example.test/lead',
    });
  });

  it('rejects a malformed dataset item with a typed contract error', () => {
    expect(() => parseProviderItem({ title: 'Missing stable identity' })).toThrow(
      ApifyProviderContractError,
    );
    expect(() => parseProviderItem({ title: 'Missing stable identity' })).toThrow(
      'dataset item must contain a stable place identifier and name',
    );
  });
});

function loadContractFixture(): IContractFixture {
  const parsed: unknown = JSON.parse(readFileSync(CONTRACT_FIXTURE_PATH, 'utf8'));

  if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Apify contract fixture must be an object');
  }

  const record = new Map(Object.entries(parsed));

  return {
    datasetItem: record.get('datasetItem'),
    run: record.get('run'),
  };
}
