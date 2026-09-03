export enum BFF_DEPENDENCY_KIND {
  DISCOVERY = 'discovery',
  QUALIFICATION = 'qualification',
}

export interface IServiceReadinessClient {
  verifyReadiness(
    dependency: BFF_DEPENDENCY_KIND,
    correlationId: string,
  ): Promise<void>;
}
