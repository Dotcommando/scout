import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';

import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { RabbitMqConnectionVerifier } from '../../outbound/rabbitmq/rabbitmq-connection-verifier.js';
import { writeQualificationFailureLog } from '../bootstrap/qualification-structured-logger.js';

enum HEALTH_STATUS {
  OK = 'ok',
  UNAVAILABLE = 'unavailable',
}

enum DEPENDENCY_HEALTH_STATUS {
  OK = 'ok',
  UNAVAILABLE = 'unavailable',
}

interface IHealthResponse {
  readonly service: string;
  readonly status: HEALTH_STATUS;
}

interface IReadinessResponse extends IHealthResponse {
  readonly dependencies: IReadinessDependencies;
}

interface IReadinessDependencies {
  readonly mongodb: DEPENDENCY_HEALTH_STATUS;
  readonly rabbitmq: DEPENDENCY_HEALTH_STATUS;
}

@Controller('health')
export class HealthController {
  public constructor(
    private readonly mongoDatabaseClient: MongoDatabaseClient,
    private readonly rabbitMqConnectionVerifier: RabbitMqConnectionVerifier,
  ) {}

  @Get('live')
  public getLiveness(): IHealthResponse {
    return {
      service: 'qualification',
      status: HEALTH_STATUS.OK,
    };
  }

  @Get('ready')
  public async getReadiness(): Promise<IReadinessResponse> {
    const startedAt = Date.now();
    const [mongodbResult, rabbitmqResult] = await Promise.allSettled([
      this.mongoDatabaseClient.verifyConnection(),
      this.rabbitMqConnectionVerifier.verifyConnection(),
    ]);
    const dependencies = {
      mongodb: toDependencyStatus(mongodbResult),
      rabbitmq: toDependencyStatus(rabbitmqResult),
    };

    logFailedDependency(
      mongodbResult,
      'mongodb',
      'verify-mongodb-connection',
      startedAt,
    );
    logFailedDependency(
      rabbitmqResult,
      'rabbitmq',
      'verify-rabbitmq-tcp-connect',
      startedAt,
    );

    if (
      dependencies.mongodb === DEPENDENCY_HEALTH_STATUS.UNAVAILABLE
      || dependencies.rabbitmq === DEPENDENCY_HEALTH_STATUS.UNAVAILABLE
    ) {
      throw new ServiceUnavailableException({
        dependencies,
        service: 'qualification',
        status: HEALTH_STATUS.UNAVAILABLE,
      });
    }

    return {
      dependencies,
      service: 'qualification',
      status: HEALTH_STATUS.OK,
    };
  }
}

function logFailedDependency(
  result: PromiseSettledResult<void>,
  dependency: string,
  brokerOperation: string,
  startedAt: number,
): void {
  if (result.status === 'fulfilled') {
    return;
  }

  writeQualificationFailureLog({
    brokerOperation,
    className: 'HealthController',
    correlationId: crypto.randomUUID(),
    durationMs: Date.now() - startedAt,
    error: result.reason,
    input: { dependency },
    method: 'getReadiness',
    operation: 'check-readiness',
    retryable: true,
  });
}

function toDependencyStatus(
  result: PromiseSettledResult<void>,
): DEPENDENCY_HEALTH_STATUS {
  return result.status === 'fulfilled'
    ? DEPENDENCY_HEALTH_STATUS.OK
    : DEPENDENCY_HEALTH_STATUS.UNAVAILABLE;
}
