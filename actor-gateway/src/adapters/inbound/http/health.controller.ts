import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { writeActorGatewayFailureLog } from '../bootstrap/actor-gateway-structured-logger.js';

enum HEALTH_STATUS {
  OK = 'ok',
  UNAVAILABLE = 'unavailable',
}

@Controller('health')
export class HealthController {
  public constructor(
    private readonly mongoDatabaseClient: MongoDatabaseClient,
  ) {}

  @Get('live')
  public getLiveness(): IHealthResponse {
    return {
      service: 'actor-gateway',
      status: HEALTH_STATUS.OK,
    };
  }

  @Get('ready')
  public async getReadiness(): Promise<IHealthResponse> {
    try {
      await this.mongoDatabaseClient.verifyConnection();
    } catch (error: unknown) {
      writeActorGatewayFailureLog({
        className: 'HealthController',
        correlationId: crypto.randomUUID(),
        error,
        input: { dependency: 'mongodb' },
        method: 'getReadiness',
        operation: 'check-readiness',
        retryable: true,
      });

      throw new ServiceUnavailableException({
        service: 'actor-gateway',
        status: HEALTH_STATUS.UNAVAILABLE,
      });
    }

    return {
      service: 'actor-gateway',
      status: HEALTH_STATUS.OK,
    };
  }
}

interface IHealthResponse {
  readonly service: string;
  readonly status: HEALTH_STATUS;
}
