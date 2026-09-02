import {
  createQualificationRuntimeConfiguration,
  RuntimeConfigurationValidationError,
} from './qualification-runtime-configuration.js';

describe('createQualificationRuntimeConfiguration', () => {
  it('maps valid Qualification environment values', () => {
    const configuration = createQualificationRuntimeConfiguration(
      {
        QUALIFICATION_ACTOR_GATEWAY_URL: 'http://localhost:3003',
        QUALIFICATION_MONGODB_URI:
          'mongodb://localhost:27017/scout_qualification',
        QUALIFICATION_PORT: '3002',
        QUALIFICATION_RABBITMQ_CONNECTION_TIMEOUT_MS: '3000',
        QUALIFICATION_RABBITMQ_PREFETCH: '10',
        QUALIFICATION_RABBITMQ_RETRY_DELAY_MS: '30000',
        QUALIFICATION_RABBITMQ_RETRY_MAX_ATTEMPTS: '3',
        QUALIFICATION_RABBITMQ_URI: 'amqp://localhost:5672',
      },
      '/workspace/.env',
    );

    expect(configuration.port).toBe(3002);
    expect(configuration.mongodbUri).toBe(
      'mongodb://localhost:27017/scout_qualification',
    );
    expect(configuration.rabbitmqRetryMaxAttempts).toBe(3);
  });

  it('reports invalid ports with a precise field path', () => {
    expect(() =>
      createQualificationRuntimeConfiguration(
        {
          QUALIFICATION_ACTOR_GATEWAY_URL: 'http://localhost:3003',
          QUALIFICATION_MONGODB_URI:
            'mongodb://localhost:27017/scout_qualification',
          QUALIFICATION_PORT: 'not-a-port',
          QUALIFICATION_RABBITMQ_CONNECTION_TIMEOUT_MS: '3000',
          QUALIFICATION_RABBITMQ_PREFETCH: '10',
          QUALIFICATION_RABBITMQ_RETRY_DELAY_MS: '30000',
          QUALIFICATION_RABBITMQ_RETRY_MAX_ATTEMPTS: '3',
          QUALIFICATION_RABBITMQ_URI: 'amqp://localhost:5672',
        },
        '/workspace/.env',
      ),
    ).toThrow(RuntimeConfigurationValidationError);
  });

  it('rejects a non-AMQP RabbitMQ URI', () => {
    expect(() =>
      createQualificationRuntimeConfiguration(
        {
          QUALIFICATION_ACTOR_GATEWAY_URL: 'http://localhost:3003',
          QUALIFICATION_MONGODB_URI:
            'mongodb://localhost:27017/scout_qualification',
          QUALIFICATION_PORT: '3002',
          QUALIFICATION_RABBITMQ_CONNECTION_TIMEOUT_MS: '3000',
          QUALIFICATION_RABBITMQ_PREFETCH: '10',
          QUALIFICATION_RABBITMQ_RETRY_DELAY_MS: '30000',
          QUALIFICATION_RABBITMQ_RETRY_MAX_ATTEMPTS: '3',
          QUALIFICATION_RABBITMQ_URI: 'https://localhost:5672',
        },
        '/workspace/.env',
      ),
    ).toThrow(/QUALIFICATION_RABBITMQ_URI/);
  });
});
