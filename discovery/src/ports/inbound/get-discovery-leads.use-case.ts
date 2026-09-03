import {
  DISCOVERY_LEAD_SORT_BY,
  IDiscoveryLeadListItem,
  LEAD_SORT_DIRECTION,
} from '../outbound/discovery-lead-read-model.port.js';

export const GET_DISCOVERY_LEADS_USE_CASE = Symbol('GET_DISCOVERY_LEADS_USE_CASE');

export interface IDiscoveryLeadPage {
  readonly items: readonly IDiscoveryLeadListItem[];
  readonly limit: number;
  readonly offset: number;
  readonly total: number;
}

export interface IGetDiscoveryLeadsUseCase {
  getLeads(
    campaignId: string,
    offset: number,
    limit: number,
    sortBy: DISCOVERY_LEAD_SORT_BY,
    sortDirection: LEAD_SORT_DIRECTION,
  ): Promise<IDiscoveryLeadPage>;
}
