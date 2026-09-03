import { IGetQualificationConfigurationsUseCase, IQualificationConfigurationPage } from '../../ports/inbound/get-qualification-configurations.use-case.js';
import { IQualificationConfigurationRepositoryPort } from '../../ports/outbound/qualification-configuration-repository.port.js';

const MAXIMUM_PAGE_LIMIT = 100;

export class GetQualificationConfigurationsService implements IGetQualificationConfigurationsUseCase {
  public constructor(private readonly configurationRepository: IQualificationConfigurationRepositoryPort) {}

  public async getConfigurations(offset: number, limit: number): Promise<IQualificationConfigurationPage> {
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('offset must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAXIMUM_PAGE_LIMIT) {
      throw new Error(`limit must be a safe integer between 1 and ${MAXIMUM_PAGE_LIMIT}`);
    }

    const page = await this.configurationRepository.findConfigurations(offset, limit);

    return { ...page, limit, offset };
  }
}
