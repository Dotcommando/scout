import {
  BFF_DEPENDENCY_KIND,
  IServiceReadinessClient,
} from '../../ports/outbound/service-readiness-client.port.js';

export enum BFF_DEPENDENCY_READINESS_STATUS {
  OK = 'ok',
  UNAVAILABLE = 'unavailable',
}

export interface IBffReadinessResult {
  readonly dependencies: IBffReadinessDependencies;
  readonly status: BFF_DEPENDENCY_READINESS_STATUS;
}

export interface IBffReadinessDependencies {
  readonly discovery: BFF_DEPENDENCY_READINESS_STATUS;
  readonly qualification: BFF_DEPENDENCY_READINESS_STATUS;
}

export class GetBffReadinessService {
  public constructor(
    private readonly serviceReadinessClient: IServiceReadinessClient,
  ) {}

  public async getReadiness(correlationId: string): Promise<IBffReadinessResult> {
    const [discovery, qualification] = await Promise.allSettled([
      this.serviceReadinessClient.verifyReadiness(
        BFF_DEPENDENCY_KIND.DISCOVERY,
        correlationId,
      ),
      this.serviceReadinessClient.verifyReadiness(
        BFF_DEPENDENCY_KIND.QUALIFICATION,
        correlationId,
      ),
    ]);
    const dependencies = {
      discovery: toReadinessStatus(discovery),
      qualification: toReadinessStatus(qualification),
    };

    return {
      dependencies,
      status: dependencies.discovery === BFF_DEPENDENCY_READINESS_STATUS.OK
        && dependencies.qualification === BFF_DEPENDENCY_READINESS_STATUS.OK
        ? BFF_DEPENDENCY_READINESS_STATUS.OK
        : BFF_DEPENDENCY_READINESS_STATUS.UNAVAILABLE,
    };
  }
}

function toReadinessStatus(
  result: PromiseSettledResult<void>,
): BFF_DEPENDENCY_READINESS_STATUS {
  return result.status === 'fulfilled'
    ? BFF_DEPENDENCY_READINESS_STATUS.OK
    : BFF_DEPENDENCY_READINESS_STATUS.UNAVAILABLE;
}
