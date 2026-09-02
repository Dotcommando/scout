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
  FAILED = 'failed',
  PENDING = 'pending',
  PUBLISHING = 'publishing',
  PUBLISHED = 'published',
}

export enum DISCOVERY_BACKFILL_RUN_STATUS {
  COMPLETED = 'completed',
  FAILED = 'failed',
  RUNNING = 'running',
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
    public readonly reservedProviderItemCount: number | undefined,
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
    if (
      reservedProviderItemCount !== undefined
      && (!Number.isSafeInteger(reservedProviderItemCount)
        || reservedProviderItemCount < 1)
    ) {
      throw new Error('reservedProviderItemCount must be a positive safe integer');
    }
  }

  public complete(completedAt: Date): DiscoveryScopeProgress {
    this.requireStatus(DISCOVERY_SCOPE_STATUS.IMPORTING);

    return this.withState(
      DISCOVERY_SCOPE_STATUS.DONE,
      completedAt,
      completedAt,
      undefined,
    );
  }

  public fail(
    failure: ITerminalFailureContext,
    updatedAt: Date,
  ): DiscoveryScopeProgress {
    if (
      this.status !== DISCOVERY_SCOPE_STATUS.RUNNING
      && this.status !== DISCOVERY_SCOPE_STATUS.IMPORTING
    ) {
      throw new Error('only active scopes can fail');
    }

    return this.withState(
      DISCOVERY_SCOPE_STATUS.FAILED,
      updatedAt,
      undefined,
      failure,
    );
  }

  public startImport(updatedAt: Date): DiscoveryScopeProgress {
    this.requireStatus(DISCOVERY_SCOPE_STATUS.RUNNING);

    if (
      this.providerRun?.status !== PROVIDER_RUN_STATUS.SUCCEEDED
      || this.providerRun.datasetReference === undefined
    ) {
      throw new Error('only completed provider runs with a dataset can be imported');
    }

    return this.withState(
      DISCOVERY_SCOPE_STATUS.IMPORTING,
      updatedAt,
      undefined,
      undefined,
    );
  }

  public recordImportProgress(
    importProgress: IImportProgress,
    updatedAt: Date,
  ): DiscoveryScopeProgress {
    this.requireStatus(DISCOVERY_SCOPE_STATUS.IMPORTING);

    if (
      !Number.isSafeInteger(importProgress.importedItemCount)
      || importProgress.importedItemCount < 0
      || !Number.isSafeInteger(importProgress.nextItemOffset)
      || importProgress.nextItemOffset < 0
    ) {
      throw new Error('import progress must contain non-negative safe integers');
    }

    return new DiscoveryScopeProgress(
      this.attemptCount,
      this.campaign,
      this.priority,
      this.claimedAt,
      this.claimedBy,
      this.completedAt,
      this.failure,
      importProgress,
      this.reservedProviderItemCount,
      this.providerRun,
      this.scopeId,
      this.status,
      updatedAt,
    );
  }

  public recordProviderRun(
    providerRun: IProviderRunReference,
    updatedAt: Date,
  ): DiscoveryScopeProgress {
    this.requireStatus(DISCOVERY_SCOPE_STATUS.RUNNING);

    if (this.reservedProviderItemCount === undefined) {
      throw new Error('provider work requires a persisted quota reservation');
    }

    return new DiscoveryScopeProgress(
      this.attemptCount,
      this.campaign,
      this.priority,
      this.claimedAt,
      this.claimedBy,
      this.completedAt,
      this.failure,
      this.importProgress,
      this.reservedProviderItemCount,
      providerRun,
      this.scopeId,
      this.status,
      updatedAt,
    );
  }

  public reserveProviderItems(
    reservedProviderItemCount: number,
    updatedAt: Date,
  ): DiscoveryScopeProgress {
    this.requireStatus(DISCOVERY_SCOPE_STATUS.RUNNING);

    if (this.reservedProviderItemCount !== undefined) {
      return this;
    }

    return new DiscoveryScopeProgress(
      this.attemptCount,
      this.campaign,
      this.priority,
      this.claimedAt,
      this.claimedBy,
      this.completedAt,
      this.failure,
      this.importProgress,
      reservedProviderItemCount,
      this.providerRun,
      this.scopeId,
      this.status,
      updatedAt,
    );
  }

  public releaseClaim(updatedAt: Date): DiscoveryScopeProgress {
    return new DiscoveryScopeProgress(
      this.attemptCount,
      this.campaign,
      this.priority,
      undefined,
      undefined,
      this.completedAt,
      this.failure,
      this.importProgress,
      this.reservedProviderItemCount,
      this.providerRun,
      this.scopeId,
      this.status,
      updatedAt,
    );
  }

  private requireStatus(expectedStatus: DISCOVERY_SCOPE_STATUS): void {
    if (this.status !== expectedStatus) {
      throw new Error(
        `scope status ${this.status} cannot transition from expected ${expectedStatus}`,
      );
    }
  }

  private withState(
    status: DISCOVERY_SCOPE_STATUS,
    updatedAt: Date,
    completedAt: Date | undefined,
    failure: ITerminalFailureContext | undefined,
  ): DiscoveryScopeProgress {
    return new DiscoveryScopeProgress(
      this.attemptCount,
      this.campaign,
      this.priority,
      this.claimedAt,
      this.claimedBy,
      completedAt,
      failure,
      this.importProgress,
      this.reservedProviderItemCount,
      this.providerRun,
      this.scopeId,
      status,
      updatedAt,
    );
  }
}

function requireNonEmptyValue(value: string, fieldName: string): void {
  if (value.trim().length === 0) {
    throw new Error(`${fieldName} must not be empty`);
  }
}
