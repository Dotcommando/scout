import {
  IDiscoveryLeadPage,
  IGetDiscoveryLeadsUseCase,
} from '../../ports/inbound/get-discovery-leads.use-case.js';
import {
  DISCOVERY_LEAD_SORT_BY,
  IDiscoveryLeadReadModelPort,
  LEAD_SORT_DIRECTION,
} from '../../ports/outbound/discovery-lead-read-model.port.js';

const MAXIMUM_PAGE_LIMIT = 100;

export class GetDiscoveryLeadsService implements IGetDiscoveryLeadsUseCase {
  public constructor(
    private readonly readModel: IDiscoveryLeadReadModelPort,
  ) {}

  public async getLeads(
    campaignId: string,
    offset: number,
    limit: number,
    sortBy: DISCOVERY_LEAD_SORT_BY,
    sortDirection: LEAD_SORT_DIRECTION,
  ): Promise<IDiscoveryLeadPage> {
    if (campaignId.trim().length === 0) {
      throw new Error('campaignId must be a non-empty string');
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      throw new Error('offset must be a non-negative safe integer');
    }
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAXIMUM_PAGE_LIMIT) {
      throw new Error('limit must be a safe integer between 1 and ' + MAXIMUM_PAGE_LIMIT);
    }

    const page = await this.readModel.listLeads({
      campaignId,
      limit,
      offset,
      sortBy,
      sortDirection,
    });

    return { ...page, limit, offset };
  }
}
