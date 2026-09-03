import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import {
  BFF_DEPENDENCY_READINESS_STATUS,
  GetBffReadinessService,
  IBffReadinessResult,
} from '../../../app/operations/get-bff-readiness.service.js';
import { writeBffFailureLog } from '../bootstrap/bff-structured-logger.js';

enum BFF_HEALTH_STATUS {
  OK = 'ok',
}

interface IBffLivenessResponse {
  readonly service: string;
  readonly status: BFF_HEALTH_STATUS;
}

@Controller('health')
export class HealthController {
  public constructor(
    private readonly getBffReadinessService: GetBffReadinessService,
  ) {}

  @Get('live')
  public getLiveness(): IBffLivenessResponse {
    return {
      service: 'bff',
      status: BFF_HEALTH_STATUS.OK,
    };
  }

  @Get('ready')
  public async getReadiness(): Promise<IBffReadinessResult> {
    const readiness = await this.getBffReadinessService.getReadiness(
      crypto.randomUUID(),
    );

    if (readiness.status === BFF_DEPENDENCY_READINESS_STATUS.UNAVAILABLE) {
      writeBffFailureLog(
        'HealthController',
        crypto.randomUUID(),
        new Error('One or more BFF dependencies are unavailable'),
        'getReadiness',
        'check-readiness',
      );

      throw new ServiceUnavailableException(readiness);
    }

    return readiness;
  }
}
