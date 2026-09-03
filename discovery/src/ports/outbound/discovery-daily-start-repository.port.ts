export enum DISCOVERY_START_TRIGGER_KIND {
  AUTO_STARTUP = 'auto-startup',
}

export enum DISCOVERY_DAILY_START_DECISION {
  ALREADY_DECIDED = 'already-decided',
  STARTED = 'started',
}

export interface IDiscoveryDailyStartClaimInput {
  readonly businessDate: string;
  readonly campaignId: string;
  readonly configurationHash: string;
  readonly occurredAt: Date;
  readonly timezone: string;
  readonly trigger: DISCOVERY_START_TRIGGER_KIND;
}

export interface IDiscoveryDailyStartClaimResult {
  readonly decision: DISCOVERY_DAILY_START_DECISION;
  readonly record: IDiscoveryDailyStartRecord;
}

export interface IDiscoveryDailyStartRecord extends IDiscoveryDailyStartClaimInput {
  readonly createdAt: Date;
}

export const DISCOVERY_DAILY_START_REPOSITORY = Symbol('DISCOVERY_DAILY_START_REPOSITORY');

export interface IDiscoveryDailyStartRepositoryPort {
  claimDailyStart(input: IDiscoveryDailyStartClaimInput): Promise<IDiscoveryDailyStartClaimResult>;
}
