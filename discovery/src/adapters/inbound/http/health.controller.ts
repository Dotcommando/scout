import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { writeDiscoveryFailureLog } from '../bootstrap/discovery-structured-logger.js';

enum HEALTH_STATUS {
  OK = 'ok',
  UNAVAILABLE = 'unavailable',
}

interface IHealthResponse {
  readonly service: string;
  readonly status: HEALTH_STATUS;
}

@Controller('health')
export class HealthController {
  public constructor(private readonly mongoDatabaseClient: MongoDatabaseClient) {}

  @Get('live')
  public getLiveness(): IHealthResponse {
    return {
      service: 'discovery',
      status: HEALTH_STATUS.OK,
    };
  }

  @Get('ready')
  public async getReadiness(): Promise<IHealthResponse> {
    try {
      await this.mongoDatabaseClient.verifyConnection();

      return {
        service: 'discovery',
        status: HEALTH_STATUS.OK,
      };
    } catch (error: unknown) {
      writeDiscoveryFailureLog({
        className: 'HealthController',
        correlationId: crypto.randomUUID(),
        error,
        method: 'getReadiness',
        operation: 'check-readiness',
        retryable: true,
      });

      throw new ServiceUnavailableException({
        service: 'discovery',
        status: HEALTH_STATUS.UNAVAILABLE,
      });
    }
  }
}
