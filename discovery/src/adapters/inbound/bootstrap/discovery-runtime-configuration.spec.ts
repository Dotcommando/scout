import {
  createDiscoveryRuntimeConfiguration,
  RuntimeConfigurationValidationError,
} from './discovery-runtime-configuration.js';

describe('createDiscoveryRuntimeConfiguration', () => {
  it('maps valid Discovery environment values', () => {
    const configuration = createDiscoveryRuntimeConfiguration(
      {
        APIFY_API_TOKEN: 'secret',
        DISCOVERY_LIVE_ARTIFACT_DIRECTORY: 'artifacts/discovery-live-executions',
        DISCOVERY_MONGODB_URI: 'mongodb://localhost:27017/scout_discovery',
        DISCOVERY_PORT: '3001',
        DISCOVERY_RABBITMQ_CONNECTION_TIMEOUT_MS: '3000',
        DISCOVERY_RABBITMQ_PREFETCH: '10',
        DISCOVERY_RABBITMQ_RETRY_DELAY_MS: '30000',
        DISCOVERY_RABBITMQ_RETRY_MAX_ATTEMPTS: '3',
        DISCOVERY_RABBITMQ_URI: 'amqp://localhost:5672',
      },
      '/workspace/.env',
    );

    expect(configuration.port).toBe(3001);
    expect(configuration.mongodbUri).toBe(
      'mongodb://localhost:27017/scout_discovery',
    );
    expect(configuration.rabbitmqPrefetch).toBe(10);
  });

  it('reports a missing secret by field name without including its value', () => {
    expect(() =>
      createDiscoveryRuntimeConfiguration(
        {
          DISCOVERY_MONGODB_URI: 'mongodb://localhost:27017/scout_discovery',
          DISCOVERY_PORT: '3001',
          DISCOVERY_RABBITMQ_CONNECTION_TIMEOUT_MS: '3000',
          DISCOVERY_RABBITMQ_PREFETCH: '10',
          DISCOVERY_RABBITMQ_RETRY_DELAY_MS: '30000',
          DISCOVERY_RABBITMQ_RETRY_MAX_ATTEMPTS: '3',
          DISCOVERY_RABBITMQ_URI: 'amqp://localhost:5672',
        },
        '/workspace/.env',
      ),
    ).toThrow(RuntimeConfigurationValidationError);
  });

  it('rejects an unbounded RabbitMQ prefetch value', () => {
    expect(() =>
      createDiscoveryRuntimeConfiguration(
        {
          APIFY_API_TOKEN: 'secret',
          DISCOVERY_LIVE_ARTIFACT_DIRECTORY: 'artifacts/discovery-live-executions',
          DISCOVERY_MONGODB_URI: 'mongodb://localhost:27017/scout_discovery',
          DISCOVERY_PORT: '3001',
          DISCOVERY_RABBITMQ_CONNECTION_TIMEOUT_MS: '3000',
          DISCOVERY_RABBITMQ_PREFETCH: '101',
          DISCOVERY_RABBITMQ_RETRY_DELAY_MS: '30000',
          DISCOVERY_RABBITMQ_RETRY_MAX_ATTEMPTS: '3',
          DISCOVERY_RABBITMQ_URI: 'amqp://localhost:5672',
        },
        '/workspace/.env',
      ),
    ).toThrow(/DISCOVERY_RABBITMQ_PREFETCH/);
  });
});
