import { HTTP_REQUEST_METHOD, IServiceHttpResponse } from './discovery-management-client.port.js';

export const QUALIFICATION_MANAGEMENT_CLIENT = Symbol('QUALIFICATION_MANAGEMENT_CLIENT');

export interface IQualificationManagementClientPort {
  request(
    method: HTTP_REQUEST_METHOD,
    path: string,
    correlationId: string,
    body?: unknown,
  ): Promise<IServiceHttpResponse>;
}
