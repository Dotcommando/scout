import {
  ACTOR_REQUEST_STATUS,
  IActorGatewayRequestStatus,
  IActorGatewayResolveRequest,
} from '@scout/contracts';

import { IActorDefinitionRegistryPort } from '../../ports/outbound/actor-definition-registry.port.js';
import {
  ACTOR_PROVIDER_RUN_STATUS,
  ActorProviderError,
  IActorProviderPort,
} from '../../ports/outbound/actor-provider.port.js';
import {
  ACTOR_EXECUTION_CLAIM_OUTCOME,
  IActorRequestRepositoryPort,
} from '../../ports/outbound/actor-request-repository.port.js';

const DATASET_PAGE_SIZE = 100;
const EXECUTION_CLAIM_STALE_MILLISECONDS = 5 * 60 * 1000;

export class ActorExecutionService {
  public constructor(
    private readonly actorProvider: IActorProviderPort,
    private readonly actorDefinitionRegistry: IActorDefinitionRegistryPort,
    private readonly actorRequestRepository: IActorRequestRepositoryPort,
  ) {}

  public async execute(
    status: IActorGatewayRequestStatus,
    input: IActorGatewayResolveRequest,
  ): Promise<IActorGatewayRequestStatus> {
    if (
      status.status === ACTOR_REQUEST_STATUS.SUCCEEDED
      || status.status === ACTOR_REQUEST_STATUS.FAILED
    ) {
      return status;
    }

    const now = new Date();
    const claim = await this.actorRequestRepository.claimExecution(
      status.requestId,
      now.toISOString(),
      new Date(now.getTime() - EXECUTION_CLAIM_STALE_MILLISECONDS).toISOString(),
    );

    if (claim.outcome === ACTOR_EXECUTION_CLAIM_OUTCOME.TERMINAL) {
      return claim.status;
    }
    if (claim.outcome === ACTOR_EXECUTION_CLAIM_OUTCOME.IN_PROGRESS) {
      return claim.status;
    }
    if (claim.outcome === ACTOR_EXECUTION_CLAIM_OUTCOME.UNKNOWN_START_OUTCOME) {
      return this.actorRequestRepository.markRequestFailed(
        status.requestId,
        now.toISOString(),
      );
    }

    const definition = this.actorDefinitionRegistry.findEnabledDefinition(
      input.actorDefinitionId,
      input.actorRevision,
    );

    try {
      const providerRun = claim.providerRunId === undefined
        ? await this.startProviderRun(status.requestId, definition.actorId, input)
        : await this.actorProvider.getRun(claim.providerRunId);

      if (providerRun.status === ACTOR_PROVIDER_RUN_STATUS.FAILED) {
        return this.actorRequestRepository.markRequestFailed(
          status.requestId,
          new Date().toISOString(),
        );
      }
      if (providerRun.status !== ACTOR_PROVIDER_RUN_STATUS.SUCCEEDED) {
        return this.actorRequestRepository.findRequestStatus(status.requestId)
          .then((current) => current ?? status);
      }
      if (providerRun.datasetId === undefined) {
        throw new Error('successful actor provider run has no dataset reference');
      }

      const records = await this.readAllRecords(providerRun.datasetId);
      const archiveId = crypto.randomUUID();

      await this.actorRequestRepository.saveArchive({
        actorDefinitionId: input.actorDefinitionId,
        actorRevision: input.actorRevision,
        archiveId,
        content: new TextEncoder().encode(JSON.stringify(records)),
        contentType: 'application/json',
        recordBoundaryIndex: records.map((_record, index) => index),
        requestId: status.requestId,
        runId: providerRun.providerRunId,
        storedAt: new Date().toISOString(),
      });

      return this.actorRequestRepository.markRequestSucceeded(
        status.requestId,
        archiveId,
        new Date().toISOString(),
      );
    } catch (error: unknown) {
      if (error instanceof ActorProviderError && !error.retryable) {
        return this.actorRequestRepository.markRequestFailed(
          status.requestId,
          new Date().toISOString(),
        );
      }

      throw error;
    }
  }

  private async startProviderRun(
    requestId: string,
    actorId: string,
    input: IActorGatewayResolveRequest,
  ) {
    const providerRun = await this.actorProvider.startRun(
      actorId,
      readInputRecord(input.canonicalInput),
    );

    await this.actorRequestRepository.recordProviderRun(
      requestId,
      providerRun.providerRunId,
      new Date().toISOString(),
    );

    return providerRun;
  }

  private async readAllRecords(datasetId: string): Promise<readonly unknown[]> {
    const records: unknown[] = [];
    let offset = 0;
    let page: readonly unknown[];

    do {
      page = await this.actorProvider.listDatasetRecords(
        datasetId,
        offset,
        DATASET_PAGE_SIZE,
      );
      records.push(...page);
      offset += page.length;
    } while (page.length === DATASET_PAGE_SIZE);

    return records;
  }
}

function readInputRecord(value: unknown): Record<string, unknown> {
  if (value === null || Array.isArray(value) || typeof value !== 'object') {
    throw new Error('actor canonical input must be an object');
  }

  return Object.fromEntries(new Map<string, unknown>(Object.entries(value)));
}
