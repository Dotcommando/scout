import {
  createDiscoveryRuntimeConfiguration,
  RuntimeConfigurationValidationError,
} from './discovery-runtime-configuration.js';

describe('createDiscoveryRuntimeConfiguration', () => {
  it('maps valid Discovery environment values', () => {
    const configuration = createDiscoveryRuntimeConfiguration(
      {
        APIFY_API_TOKEN: 'secret',
        DISCOVERY_MONGODB_URI: 'mongodb://localhost:27017/scout_discovery',
        DISCOVERY_PORT: '3001',
      },
      '/workspace/.env',
    );

    expect(configuration.port).toBe(3001);
    expect(configuration.mongodbUri).toBe(
      'mongodb://localhost:27017/scout_discovery',
    );
  });

  it('reports a missing secret by field name without including its value', () => {
    expect(() =>
      createDiscoveryRuntimeConfiguration(
        {
          DISCOVERY_MONGODB_URI: 'mongodb://localhost:27017/scout_discovery',
          DISCOVERY_PORT: '3001',
        },
        '/workspace/.env',
      ),
    ).toThrow(RuntimeConfigurationValidationError);
  });
});
