import { IGetQualificationOperationsUseCase, IQualificationExecutionPage, IQualificationStatusView, IQualifiedLeadPage } from '../../ports/inbound/get-qualification-operations.use-case.js';
import { IClockPort } from '../../ports/outbound/clock.port.js';
import { IQualificationExecutionView, IQualificationLeadView, IQualificationReadModelPort } from '../../ports/outbound/qualification-read-model.port.js';

const MAXIMUM_PAGE_LIMIT = 100;

export class GetQualificationOperationsService implements IGetQualificationOperationsUseCase {
  public constructor(private readonly clock: IClockPort, private readonly readModel: IQualificationReadModelPort) {}

  public getExecution(executionId: string): Promise<IQualificationExecutionView | undefined> {
    return this.readModel.findExecution(executionId);
  }

  public getLead(campaignId: string, leadId: string, profileVersion: number): Promise<IQualificationLeadView | undefined> {
    return this.readModel.findLead(campaignId, leadId, profileVersion);
  }

  public async getQualifiedLeads(campaignId: string, profileVersion: number, offset: number, limit: number): Promise<IQualifiedLeadPage> {
    validatePage(offset, limit);
    const page = await this.readModel.listQualifiedLeads(campaignId, profileVersion, offset, limit);

    return { ...page, asOf: this.clock.getCurrentTime(), limit, offset };
  }

  public async getStatus(campaignId: string, profileVersion: number): Promise<IQualificationStatusView> {
    return { ...(await this.readModel.getStatusCounts(campaignId, profileVersion)), asOf: this.clock.getCurrentTime(), campaignId, profileVersion };
  }

  public async listExecutions(campaignId: string, offset: number, limit: number): Promise<IQualificationExecutionPage> {
    validatePage(offset, limit);

    return { ...(await this.readModel.listExecutions(campaignId, offset, limit)), limit, offset };
  }
}

function validatePage(offset: number, limit: number): void {
  if (!Number.isSafeInteger(offset) || offset < 0) {
    throw new Error('offset must be a non-negative safe integer');
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAXIMUM_PAGE_LIMIT) {
    throw new Error(`limit must be a safe integer between 1 and ${MAXIMUM_PAGE_LIMIT}`);
  }
}
