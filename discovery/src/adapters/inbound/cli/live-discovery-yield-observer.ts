import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { LIVE_DISCOVERY_PAUSE_REASON } from '../../../domain/discovery/live-discovery-execution-model.js';
import { ILiveDiscoveryExecutionConfigurationPort } from '../../../ports/outbound/live-discovery-execution-configuration.port.js';
import { ILiveDiscoveryExecutionRepositoryPort } from '../../../ports/outbound/live-discovery-execution-repository.port.js';
import { ILiveDiscoveryImportedBatch, ILiveDiscoveryYieldObserverPort } from '../../../ports/outbound/live-discovery-yield-observer.port.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import { writeDiscoveryLog } from '../bootstrap/discovery-structured-logger.js';

export class LiveDiscoveryYieldObserver implements ILiveDiscoveryYieldObserverPort {
  public constructor(
    private readonly executionId: string,
    private readonly executionConfiguration: ILiveDiscoveryExecutionConfigurationPort,
    private readonly executionRepository: ILiveDiscoveryExecutionRepositoryPort,
    private readonly runtimeConfiguration: DiscoveryRuntimeConfiguration,
  ) {}

  public async recordImportedBatch(input: ILiveDiscoveryImportedBatch): Promise<boolean> {
    const configuration = this.executionConfiguration.getLiveExecutionConfiguration();
    const result = await this.executionRepository.recordImportedBatch({
      batchInsertedLeadCount: input.batchInsertedLeadCount,
      batchProviderItemCount: input.batchProviderItemCount,
      executionId: this.executionId,
      minimumUniqueLeadRate: configuration.minimumUniqueLeadRate,
      minimumYieldEvaluationProviderItems: configuration.minimumYieldEvaluationProviderItems,
      recordedAt: input.occurredAt,
    });
    const artifact = {
      batchInsertedLeadCount: input.batchInsertedLeadCount,
      batchProviderItemCount: input.batchProviderItemCount,
      batchSequence: result.batchSequence,
      campaignId: input.campaignId,
      cumulativeInsertedLeadCount: result.cumulativeInsertedLeadCount,
      cumulativeProviderItemCount: result.cumulativeProviderItemCount,
      executionId: this.executionId,
      occurredAt: input.occurredAt.toISOString(),
      providerRunId: input.providerRunId,
      scopeId: input.scopeId,
      uniqueLeadRate: result.uniqueLeadRate,
    };

    try {
      await this.writeArtifact(result.batchSequence, artifact);
    } catch (error: unknown) {
      await this.executionRepository.pauseExecution({
        executionId: this.executionId,
        pausedAt: input.occurredAt,
        reason: LIVE_DISCOVERY_PAUSE_REASON.ARTIFACT_WRITE_FAILURE,
      });

      throw error;
    }
    writeDiscoveryLog({
      campaignId: input.campaignId,
      className: 'LiveDiscoveryYieldObserver',
      correlationId: this.executionId,
      input: artifact,
      level: 'info',
      method: 'recordImportedBatch',
      operation: 'discovery-unique-yield',
      providerRunId: input.providerRunId,
      retryable: false,
      service: 'discovery',
      scopeId: input.scopeId,
    });

    return result.paused;
  }

  private async writeArtifact(batchSequence: number, artifact: unknown): Promise<void> {
    const directory = join(this.runtimeConfiguration.liveArtifactDirectory, this.executionId);
    const finalPath = join(directory, `batch-${batchSequence}.json`);
    const temporaryPath = `${finalPath}.tmp`;

    await mkdir(directory, { recursive: true });
    await writeFile(temporaryPath, JSON.stringify(artifact), { encoding: 'utf8', flag: 'wx' });
    await rename(temporaryPath, finalPath);
  }
}
