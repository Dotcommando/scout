import { IDiscoveryConfigurationPage, IGetDiscoveryConfigurationsUseCase } from '../../ports/inbound/get-discovery-configurations.use-case.js';
import { IDiscoveryCampaignConfigurationRepositoryPort } from '../../ports/outbound/discovery-campaign-configuration-repository.port.js';

const MAXIMUM_PAGE_LIMIT = 100;

export class GetDiscoveryConfigurationsService
  implements IGetDiscoveryConfigurationsUseCase {
  public constructor(
    private readonly configurationRepository: IDiscoveryCampaignConfigurationRepositoryPort,
  ) {}

  public async getConfigurations(
    offset: number,
    limit: number,
  ): Promise<IDiscoveryConfigurationPage> {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('offset must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAXIMUM_PAGE_LIMIT) {
      throw new Error(`limit must be a safe integer between 1 and ${MAXIMUM_PAGE_LIMIT}`);
    }

    const page = await this.configurationRepository.findConfigurations(offset, limit);

    return {
      items: page.items,
      limit,
      offset,
      total: page.total,
    };
  }
}
