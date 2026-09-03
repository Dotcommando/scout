export enum HTTP_REQUEST_METHOD {
  DELETE = 'DELETE',
  GET = 'GET',
  POST = 'POST',
  PUT = 'PUT',
}

export interface IServiceHttpResponse {
  readonly body: unknown;
  readonly statusCode: number;
}

export const DISCOVERY_MANAGEMENT_CLIENT = Symbol('DISCOVERY_MANAGEMENT_CLIENT');

export interface IDiscoveryManagementClientPort {
  request(
    method: HTTP_REQUEST_METHOD,
    path: string,
    correlationId: string,
    body?: unknown,
  ): Promise<IServiceHttpResponse>;
}
