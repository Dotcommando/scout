import {
  CampaignConfigurationValidationError,
  parseDiscoveryCampaignConfiguration,
} from './discovery-campaign-configuration.js';

const VALID_CONFIGURATION = `version: 1
campaignId: campaign-a
source:
  kind: google-maps
  actorId: compass/crawler-google-places
searchQueries:
  - independent hotel
scopes:
  - id: GB
    label: United Kingdom
    priority: 1
limits:
  dailyProviderItemLimit: 500
  maxProviderItemsPerRun: 100
`;

describe('parseDiscoveryCampaignConfiguration', () => {
  it('validates and hashes the campaign configuration', () => {
    const configuration = parseDiscoveryCampaignConfiguration(
      VALID_CONFIGURATION,
      '/workspace/campaign.yaml',
    );

    expect(configuration.campaignId).toBe('campaign-a');
    expect(configuration.limits.dailyProviderItemLimit).toBe(500);
    expect(configuration.configurationHash).toHaveLength(64);
  });

  it('rejects a per-run limit above the daily quota', () => {
    expect(() =>
      parseDiscoveryCampaignConfiguration(
        VALID_CONFIGURATION.replace(
          'maxProviderItemsPerRun: 100',
          'maxProviderItemsPerRun: 600',
        ),
        '/workspace/campaign.yaml',
      ),
    ).toThrow(CampaignConfigurationValidationError);
  });
});
