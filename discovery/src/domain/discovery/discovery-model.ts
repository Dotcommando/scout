export enum DISCOVERY_SOURCE_KIND {
  GOOGLE_MAPS = 'google-maps',
}

export const DISCOVERY_SOURCE_KIND_ARRAY = Object.values(
  DISCOVERY_SOURCE_KIND,
);

export enum DISCOVERY_SCOPE_STATUS {
  DONE = 'done',
  FAILED = 'failed',
  IMPORTING = 'importing',
  PENDING = 'pending',
  RUNNING = 'running',
}

export const DISCOVERY_SCOPE_STATUS_ARRAY = Object.values(
  DISCOVERY_SCOPE_STATUS,
);

export enum PROVIDER_RUN_STATUS {
  FAILED = 'failed',
  PENDING = 'pending',
  RUNNING = 'running',
  SUCCEEDED = 'succeeded',
}

export const PROVIDER_RUN_STATUS_ARRAY = Object.values(PROVIDER_RUN_STATUS);

export enum DISCOVERY_OUTPUT_STATUS {
  PENDING = 'pending',
  PUBLISHED = 'published',
}

export class DiscoveryCampaignReference {
  public constructor(public readonly campaignId: string) {
    requireNonEmptyValue(campaignId, 'campaignId');
  }
}

export class LeadSourceIdentity {
  public constructor(
    public readonly externalId: string,
    public readonly sourceKind: DISCOVERY_SOURCE_KIND,
  ) {
    requireNonEmptyValue(externalId, 'externalId');
  }
}

export interface ILeadDetails {
  readonly address?: string;
  readonly name: string;
  readonly phoneNumber?: string;
  readonly websiteUrl?: string;
}

export class Lead {
  public constructor(
    public readonly createdAt: Date,
    public readonly details: ILeadDetails,
    public readonly leadId: string,
    public readonly sourceIdentity: LeadSourceIdentity,
    public readonly updatedAt: Date,
  ) {
    requireNonEmptyValue(leadId, 'leadId');
    requireNonEmptyValue(details.name, 'name');
  }
}

export interface IProviderRunReference {
  readonly datasetReference?: string;
  readonly providerRunId: string;
  readonly status: PROVIDER_RUN_STATUS;
}

export interface IImportProgress {
  readonly importedItemCount: number;
  readonly nextItemOffset: number;
}

export interface ITerminalFailureContext {
  readonly code?: string;
  readonly message: string;
  readonly occurredAt: Date;
}

export class DiscoveryScopeProgress {
  public constructor(
    public readonly attemptCount: number,
    public readonly campaign: DiscoveryCampaignReference,
    public readonly priority: number,
    public readonly claimedAt: Date | undefined,
    public readonly claimedBy: string | undefined,
    public readonly completedAt: Date | undefined,
    public readonly failure: ITerminalFailureContext | undefined,
    public readonly importProgress: IImportProgress | undefined,
    public readonly providerRun: IProviderRunReference | undefined,
    public readonly scopeId: string,
    public readonly status: DISCOVERY_SCOPE_STATUS,
    public readonly updatedAt: Date,
  ) {
    requireNonEmptyValue(scopeId, 'scopeId');

    if (!Number.isSafeInteger(priority)) {
      throw new Error('priority must be a safe integer');
    }
    if (!Number.isSafeInteger(attemptCount) || attemptCount < 0) {
      throw new Error('attemptCount must be a non-negative safe integer');
    }
  }
}

function requireNonEmptyValue(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }
}
