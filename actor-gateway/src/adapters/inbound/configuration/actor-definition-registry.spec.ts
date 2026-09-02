import { getActorDefinition } from './actor-definition-registry.js';

describe('actor definition registry', () => {
  it('returns only enabled, revision-matching actor definitions', () => {
    expect(getActorDefinition('google-maps-search', 'latest').actorId).toBe(
      'compass/crawler-google-places',
    );
  });

  it('rejects unknown definitions', () => {
    expect(() => getActorDefinition('unknown', 'latest')).toThrow(
      'Actor definition is not enabled',
    );
  });
});
