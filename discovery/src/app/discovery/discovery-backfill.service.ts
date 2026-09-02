import {
  DISCOVERY_BACKFILL_RUN_STATUS,
  DISCOVERY_OUTPUT_STATUS,
  Lead,
} from '../../domain/discovery/discovery-model.js';
import {
  IDiscoveryBackfillResult,
  IRunDiscoveryBackfillInput,
  IRunDiscoveryBackfillUseCase,
} from '../../ports/inbound/run-discovery-backfill.use-case.js';
import { IClockPort } from '../../ports/outbound/clock.port.js';
import {
  IDiscoveryBackfillRun,
  IDiscoveryBackfillRunRepositoryPort,
} from '../../ports/outbound/discovery-backfill-run-repository.port.js';
import { IDiscoveryCampaignConfigurationPort } from '../../ports/outbound/discovery-campaign-configuration.port.js';
import {
  DISCOVERY_OUTPUT_SAVE_OUTCOME,
  IDiscoveryOutputRepositoryPort,
} from '../../ports/outbound/discovery-output-repository.port.js';
import { ILeadRepositoryPort } from '../../ports/outbound/lead-repository.port.js';
import {
  createDiscoveryOutputPayload,
  DISCOVERY_OUTPUT_ORIGIN,
} from './discovery-output-payload.js';
import { createStableIdentifier } from './stable-identifier.js';

const BACKFILL_PAGE_SIZE = 100;

export class DiscoveryBackfillService implements IRunDiscoveryBackfillUseCase {
  public constructor(
    private readonly campaignConfiguration: IDiscoveryCampaignConfigurationPort,
    private readonly clock: IClockPort,
    private readonly backfillRunRepository: IDiscoveryBackfillRunRepositoryPort,
    private readonly discoveryOutputRepository: IDiscoveryOutputRepositoryPort,
    private readonly leadRepository: ILeadRepositoryPort,
  ) {}

  public async runBackfill(
    input: IRunDiscoveryBackfillInput,
  ): Promise<IDiscoveryBackfillResult> {
    this.validateInput(input);

    const configuration = this.campaignConfiguration.getCampaignConfiguration();

    if (configuration.campaignId !== input.campaignId) {
      throw new Error(`campaign ${input.campaignId} is not the configured Discovery campaign`);
    }

    const previousRun = await this.backfillRunRepository.findBackfillRun(input.runId);

    if (previousRun !== undefined) {
      this.requireMatchingRun(previousRun, input, configuration.configurationHash);
    }
    if (previousRun?.status === DISCOVERY_BACKFILL_RUN_STATUS.COMPLETED) {
      return this.toResult(previousRun);
    }

    const startedAt = this.clock.getCurrentTime();
    const run = await this.backfillRunRepository.startBackfillRun({
      campaignId: input.campaignId,
      configurationHash: configuration.configurationHash,
      correlationId: input.correlationId,
      createdAt: startedAt,
      dryRun: input.dryRun,
      maximumLeadCount: input.maximumLeadCount,
      ...(input.leadIdPrefix === undefined
        ? {}
        : { leadIdPrefix: input.leadIdPrefix }),
      qualificationCatalogRevision: input.qualificationCatalogRevision,
      runId: input.runId,
      selectedSourceKind: input.sourceKind,
    });

    this.requireMatchingRun(run, input, configuration.configurationHash);

    try {
      const result = await this.createOutputs(input);
      const completedAt = this.clock.getCurrentTime();

      await this.backfillRunRepository.completeBackfillRun({
        completedAt,
        runId: input.runId,
        totalExistingOutputCount: result.existingOutputCount,
        totalInsertedOutputCount: result.insertedOutputCount,
        totalSelectedLeadCount: result.selectedLeadCount,
      });

      return result;
    } catch (error: unknown) {
      await this.backfillRunRepository.failBackfillRun({
        failedAt: this.clock.getCurrentTime(),
        failureMessage: getErrorMessage(error),
        runId: input.runId,
      });

      throw error;
    }
  }

  private async createOutputs(
    input: IRunDiscoveryBackfillInput,
  ): Promise<IDiscoveryBackfillResult> {
    let afterLeadId: string | undefined;
    let existingOutputCount = 0;
    let insertedOutputCount = 0;
    let selectedLeadCount = 0;

    while (selectedLeadCount < input.maximumLeadCount) {
      const remainingLeadCount = input.maximumLeadCount - selectedLeadCount;
      const page = await this.leadRepository.findLeadsForBackfill({
        ...(afterLeadId === undefined ? {} : { afterLeadId }),
        limit: Math.min(BACKFILL_PAGE_SIZE, remainingLeadCount),
        ...(input.leadIdPrefix === undefined
          ? {}
          : { leadIdPrefix: input.leadIdPrefix }),
        sourceKind: input.sourceKind,
      });

      if (page.leads.length === 0) {
        break;
      }

      for (const lead of page.leads) {
        const outputOutcome = input.dryRun
          ? undefined
          : await this.saveBackfillOutput(input, lead);

        selectedLeadCount += 1;
        afterLeadId = lead.leadId;

        if (outputOutcome === DISCOVERY_OUTPUT_SAVE_OUTCOME.EXISTING) {
          existingOutputCount += 1;
        }
        if (outputOutcome === DISCOVERY_OUTPUT_SAVE_OUTCOME.INSERTED) {
          insertedOutputCount += 1;
        }
      }
    }

    return {
      existingOutputCount,
      insertedOutputCount,
      runId: input.runId,
      selectedLeadCount,
    };
  }

  private requireMatchingRun(
    run: IDiscoveryBackfillRun,
    input: IRunDiscoveryBackfillInput,
    configurationHash: string,
  ): void {
    if (
      run.campaignId !== input.campaignId
      || run.configurationHash !== configurationHash
      || run.dryRun !== input.dryRun
      || run.maximumLeadCount !== input.maximumLeadCount
      || run.leadIdPrefix !== input.leadIdPrefix
      || run.qualificationCatalogRevision !== input.qualificationCatalogRevision
      || run.selectedSourceKind !== input.sourceKind
    ) {
      throw new Error(`backfill run ${input.runId} does not match the requested selection`);
    }
  }

  private async saveBackfillOutput(
    input: IRunDiscoveryBackfillInput,
    lead: Lead,
  ): Promise<DISCOVERY_OUTPUT_SAVE_OUTCOME> {
    const occurredAt = this.clock.getCurrentTime();
    const outputId = createStableIdentifier(
      'discovery-output',
      input.campaignId,
      lead.leadId,
    );

    return this.discoveryOutputRepository.saveDiscoveryOutput({
      campaignId: input.campaignId,
      createdAt: occurredAt,
      leadId: lead.leadId,
      outputId,
      payload: createDiscoveryOutputPayload({
        backfillRunId: input.runId,
        campaignId: input.campaignId,
        correlationId: input.correlationId,
        lead,
        occurredAt,
        origin: DISCOVERY_OUTPUT_ORIGIN.BACKFILL,
        outputId,
      }),
      status: DISCOVERY_OUTPUT_STATUS.PENDING,
    });
  }

  private toResult(run: IDiscoveryBackfillRun): IDiscoveryBackfillResult {
    return {
      existingOutputCount: run.totalExistingOutputCount,
      insertedOutputCount: run.totalInsertedOutputCount,
      runId: run.runId,
      selectedLeadCount: run.totalSelectedLeadCount,
    };
  }

  private validateInput(input: IRunDiscoveryBackfillInput): void {
    if (!input.confirmed && !input.dryRun) {
      throw new Error('backfill execution requires explicit confirmation');
    }
    if (!Number.isSafeInteger(input.maximumLeadCount) || input.maximumLeadCount < 1) {
      throw new Error('maximumLeadCount must be a positive safe integer');
    }
    if (
      input.campaignId.trim().length === 0
      || (input.leadIdPrefix?.trim().length === 0)
      || input.qualificationCatalogRevision.trim().length === 0
      || input.runId.trim().length === 0
    ) {
      throw new Error('campaignId, qualificationCatalogRevision, and runId must not be empty');
    }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown backfill failure';
}
