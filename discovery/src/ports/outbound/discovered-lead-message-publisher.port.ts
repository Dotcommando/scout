import { IDiscoveredLeadEvent } from '@scout/contracts';

export interface IDiscoveredLeadMessagePublisherPort {
  publishDiscoveredLead(event: IDiscoveredLeadEvent): Promise<void>;
}
