import { IDiscoveryCampaignConfiguration } from '../../../app/discovery/discovery-campaign-configuration.js';
import { DiscoveryProgressService } from '../../../app/discovery/discovery-progress.service.js';
import { LIVE_DISCOVERY_EXECUTION_PURPOSE } from '../../../domain/discovery/live-discovery-execution-model.js';
import { IDiscoveryCampaignConfigurationPort } from '../../../ports/outbound/discovery-campaign-configuration.port.js';
import { ActorGatewayClient } from '../../outbound/actor-gateway/actor-gateway-client.js';
import { ActorGatewayGoogleMapsProviderAdapter } from '../../outbound/actor-gateway/actor-gateway-google-maps-provider-adapter.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { MongoDiscoveryOutputRepository } from '../../outbound/mongodb/mongo-discovery-output-repository.js';
import { MongoDiscoveryStateRepository } from '../../outbound/mongodb/mongo-discovery-state-repository.js';
import { MongoLeadRepository } from '../../outbound/mongodb/mongo-lead-repository.js';
import { MongoLiveDiscoveryExecutionRepository } from '../../outbound/mongodb/mongo-live-discovery-execution-repository.js';
import { MongoProviderQuotaRepository } from '../../outbound/mongodb/mongo-provider-quota-repository.js';
import { SystemClock } from '../../outbound/time/system-clock.js';
import { DiscoveryRuntimeConfiguration } from '../bootstrap/discovery-runtime-configuration.js';
import { writeDiscoveryFailureLog, writeDiscoveryLog } from '../bootstrap/discovery-structured-logger.js';
import { DiscoveryCampaignConfiguration } from '../configuration/discovery-campaign-configuration.js';
import { LiveDiscoveryExecutionConfiguration } from '../configuration/live-discovery-execution-configuration.js';
import { LiveDiscoveryYieldObserver } from './live-discovery-yield-observer.js';
import { LiveProviderQuotaRepository } from './live-provider-quota-repository.js';

interface ILiveCommand {
  readonly executionId: string;
  readonly purpose: LIVE_DISCOVERY_EXECUTION_PURPOSE;
}

async function main(): Promise<void> {
  const command = parseCommand(process.argv.slice(2));
  const correlationId = crypto.randomUUID();
  const runtime = new DiscoveryRuntimeConfiguration();
  const campaign = new DiscoveryCampaignConfiguration();
  const executionConfiguration = new LiveDiscoveryExecutionConfiguration();
  const database = new MongoDatabaseClient(runtime);

  await database.onModuleInit();

  try {
    const outputs = new MongoDiscoveryOutputRepository(database);
    const state = new MongoDiscoveryStateRepository(database);
    const leads = new MongoLeadRepository(database);
    const quota = new MongoProviderQuotaRepository(database);
    const executions = new MongoLiveDiscoveryExecutionRepository(database);

    await Promise.all([outputs.onModuleInit(), state.onModuleInit(), leads.onModuleInit(), quota.onModuleInit(), executions.onModuleInit()]);
    const configuration = executionConfiguration.getLiveExecutionConfiguration();
    const maximumItemCount = command.purpose === LIVE_DISCOVERY_EXECUTION_PURPOSE.PREFLIGHT
      ? configuration.preflightMaximumProviderItems
      : configuration.maximumProviderItemsPerRun;
    const service = new DiscoveryProgressService(
      new LiveCampaignConfiguration(campaign.getCampaignConfiguration(), maximumItemCount),
      new SystemClock(),
      outputs,
      new ActorGatewayGoogleMapsProviderAdapter(new ActorGatewayClient(runtime)),
      leads,
      state,
      new LiveProviderQuotaRepository(campaign.getCampaignConfiguration().configurationHash, executionConfiguration, command.executionId, executions, command.purpose, quota),
      new LiveDiscoveryYieldObserver(command.executionId, executionConfiguration, executions, runtime),
    );
    const result = await service.advanceDiscoveryWork({ correlationId, workerId: `live-execution-${process.pid}` });

    writeDiscoveryLog({ className: 'RunLiveDiscoveryExecutionCommand', correlationId, input: { ...command, result }, level: 'info', method: 'main', operation: 'run-live-discovery-execution', retryable: false, service: 'discovery' });
  } finally {
    await database.onModuleDestroy();
  }
}

function parseCommand(argumentsList: readonly string[]): ILiveCommand {
  const executionIndex = argumentsList.indexOf('--execution-id');
  const purposeIndex = argumentsList.indexOf('--purpose');

  if (executionIndex === -1 || purposeIndex === -1 || !argumentsList.includes('--confirm')) {
    throw new Error('requires --execution-id, --purpose, and --confirm');
  }

  const executionId = argumentsList[executionIndex + 1];
  const purposeValue = argumentsList[purposeIndex + 1];

  if (executionId === undefined || executionId.trim().length === 0) {
    throw new Error('--execution-id requires a value');
  }
  if (purposeValue === LIVE_DISCOVERY_EXECUTION_PURPOSE.PREFLIGHT || purposeValue === LIVE_DISCOVERY_EXECUTION_PURPOSE.APPROVED_COLLECTION) {
    return { executionId, purpose: purposeValue };
  }

  throw new Error('--purpose is invalid');
}

class LiveCampaignConfiguration implements IDiscoveryCampaignConfigurationPort {
  public constructor(private readonly source: IDiscoveryCampaignConfiguration, private readonly maximumItemCount: number) {}

  public getCampaignConfiguration(): IDiscoveryCampaignConfiguration {
    return { ...this.source, limits: { dailyProviderItemLimit: 100, maxProviderItemsPerRun: this.maximumItemCount } };
  }
}

void main().catch((error: unknown) => {
  writeDiscoveryFailureLog({ className: 'RunLiveDiscoveryExecutionCommand', correlationId: crypto.randomUUID(), error, method: 'main', operation: 'run-live-discovery-execution', retryable: false });
  process.exitCode = 1;
});
