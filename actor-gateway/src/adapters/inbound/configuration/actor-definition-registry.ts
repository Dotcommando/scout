import { Injectable } from '@nestjs/common';

import { IActorDefinitionPort, IActorDefinitionRegistryPort } from '../../../ports/outbound/actor-definition-registry.port.js';

export enum ACTOR_PROVIDER_KIND {
  APIFY = 'APIFY',
}

export interface IActorDefinition {
  readonly actorDefinitionId: string;
  readonly actorId: string;
  readonly actorRevision: string;
  readonly enabled: boolean;
  readonly providerKind: ACTOR_PROVIDER_KIND;
}

const ACTOR_DEFINITIONS: readonly IActorDefinition[] = [
  {
    actorDefinitionId: 'google-maps-search',
    actorId: 'compass/crawler-google-places',
    actorRevision: 'latest',
    enabled: true,
    providerKind: ACTOR_PROVIDER_KIND.APIFY,
  },
  {
    actorDefinitionId: 'google-hotels-market',
    actorId: 'solidcode/google-hotels-scraper',
    actorRevision: 'latest',
    enabled: true,
    providerKind: ACTOR_PROVIDER_KIND.APIFY,
  },
];

export function getActorDefinition(
  actorDefinitionId: string,
  actorRevision: string,
): IActorDefinition {
  const definition = ACTOR_DEFINITIONS.find((candidate) =>
    candidate.actorDefinitionId === actorDefinitionId
      && candidate.actorRevision === actorRevision
      && candidate.enabled,
  );

  if (definition === undefined) {
    throw new Error(`Actor definition is not enabled: ${actorDefinitionId}@${actorRevision}`);
  }

  return definition;
}

@Injectable()
export class ActorDefinitionRegistry implements IActorDefinitionRegistryPort {
  public findEnabledDefinition(actorDefinitionId: string, actorRevision: string): IActorDefinitionPort {
    return getActorDefinition(actorDefinitionId, actorRevision);
  }
}
