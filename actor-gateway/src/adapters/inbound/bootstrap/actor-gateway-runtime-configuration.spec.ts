import {
  ActorGatewayRuntimeConfigurationValidationError,
  createActorGatewayRuntimeConfiguration,
} from './actor-gateway-runtime-configuration.js';

describe('ActorGatewayRuntimeConfiguration', () => {
  it('parses validated settings', () => {
    expect(createActorGatewayRuntimeConfiguration({
      APIFY_API_TOKEN: 'secret',
      ACTOR_GATEWAY_MONGODB_URI: 'mongodb://localhost:27017/scout_actor_gateway',
      ACTOR_GATEWAY_PORT: '3003',
    }, '.env')).toEqual({
      apifyApiToken: 'secret',
      mongodbUri: 'mongodb://localhost:27017/scout_actor_gateway',
      port: 3003,
    });
  });

  it('rejects an invalid MongoDB URI', () => {
    expect(() => createActorGatewayRuntimeConfiguration({
      APIFY_API_TOKEN: 'secret',
      ACTOR_GATEWAY_MONGODB_URI: 'http://localhost:27017/scout_actor_gateway',
      ACTOR_GATEWAY_PORT: '3003',
    }, '.env')).toThrow(ActorGatewayRuntimeConfigurationValidationError);
  });
});
