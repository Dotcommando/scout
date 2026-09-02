import {
  ActorGatewayRuntimeConfigurationValidationError,
  createActorGatewayRuntimeConfiguration,
} from './actor-gateway-runtime-configuration.js';

describe('ActorGatewayRuntimeConfiguration', () => {
  it('parses validated settings', () => {
    expect(createActorGatewayRuntimeConfiguration({
      ACTOR_GATEWAY_MONGODB_URI: 'mongodb://localhost:27017/scout_actor_gateway',
      ACTOR_GATEWAY_PORT: '3003',
    }, '.env')).toEqual({
      mongodbUri: 'mongodb://localhost:27017/scout_actor_gateway',
      port: 3003,
    });
  });

  it('rejects an invalid MongoDB URI', () => {
    expect(() => createActorGatewayRuntimeConfiguration({
      ACTOR_GATEWAY_MONGODB_URI: 'http://localhost:27017/scout_actor_gateway',
      ACTOR_GATEWAY_PORT: '3003',
    }, '.env')).toThrow(ActorGatewayRuntimeConfigurationValidationError);
  });
});
