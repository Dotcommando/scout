import { ILiveDiscoveryExecutionConfiguration } from '../../app/discovery/live-discovery-execution-configuration.js';

export interface ILiveDiscoveryExecutionConfigurationPort {
  getLiveExecutionConfiguration(): ILiveDiscoveryExecutionConfiguration;
}
