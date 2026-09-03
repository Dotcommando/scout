export const ACTOR_DEFINITION_REGISTRY = Symbol('ACTOR_DEFINITION_REGISTRY');

export interface IActorDefinitionPort {
  readonly actorId: string;
}

export interface IActorDefinitionRegistryPort {
  findEnabledDefinition(actorDefinitionId: string, actorRevision: string): IActorDefinitionPort;
}
