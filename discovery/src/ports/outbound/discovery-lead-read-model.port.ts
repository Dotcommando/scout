import { DISCOVERY_SOURCE_KIND } from '../../domain/discovery/discovery-model.js';

export const DISCOVERY_LEAD_READ_MODEL = Symbol('DISCOVERY_LEAD_READ_MODEL');

export enum DISCOVERY_LEAD_SORT_BY {
  CREATED_AT = 'createdAt',
  NAME = 'name',
}

export const DISCOVERY_LEAD_SORT_BY_ARRAY = Object.values(DISCOVERY_LEAD_SORT_BY);

export enum LEAD_SORT_DIRECTION {
  ASC = 'asc',
  DESC = 'desc',
}

export const LEAD_SORT_DIRECTION_ARRAY = Object.values(LEAD_SORT_DIRECTION);

export interface IDiscoveryLeadListInput {
  readonly campaignId: string;
  readonly limit: number;
  readonly offset: number;
  readonly sortBy: DISCOVERY_LEAD_SORT_BY;
  readonly sortDirection: LEAD_SORT_DIRECTION;
}

export interface IDiscoveryLeadListItem {
  readonly address?: string;
  readonly createdAt: Date;
  readonly externalId: string;
  readonly leadId: string;
  readonly name: string;
  readonly phoneNumber?: string;
  readonly sourceKind: DISCOVERY_SOURCE_KIND;
  readonly websiteUrl?: string;
}

export interface IDiscoveryLeadListPage {
  readonly items: readonly IDiscoveryLeadListItem[];
  readonly total: number;
}

export interface IDiscoveryLeadReadModelPort {
  listLeads(input: IDiscoveryLeadListInput): Promise<IDiscoveryLeadListPage>;
}
