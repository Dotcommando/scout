import {
  BFF_DEPENDENCY_READINESS_STATUS,
  GetBffReadinessService,
} from '../src/app/operations/get-bff-readiness.service.js';
import {
  BFF_DEPENDENCY_KIND,
  IServiceReadinessClient,
} from '../src/ports/outbound/service-readiness-client.port.js';

class FakeServiceReadinessClient implements IServiceReadinessClient {
  public readonly unavailableDependencies = new Set<BFF_DEPENDENCY_KIND>();

  public async verifyReadiness(
    dependency: BFF_DEPENDENCY_KIND,
    correlationId: string,
  ): Promise<void> {
    void correlationId;

    if (this.unavailableDependencies.has(dependency)) {
      throw new Error('unavailable');
    }
  }
}

describe('GetBffReadinessService', () => {
  it('reports ready only when both service readiness checks pass', async () => {
    const client = new FakeServiceReadinessClient();
    const service = new GetBffReadinessService(client);

    await expect(service.getReadiness('correlation-id')).resolves.toEqual({
      dependencies: {
        discovery: BFF_DEPENDENCY_READINESS_STATUS.OK,
        qualification: BFF_DEPENDENCY_READINESS_STATUS.OK,
      },
      status: BFF_DEPENDENCY_READINESS_STATUS.OK,
    });
  });

  it('reports unavailable without hiding a failed dependency', async () => {
    const client = new FakeServiceReadinessClient();
    const service = new GetBffReadinessService(client);

    client.unavailableDependencies.add(BFF_DEPENDENCY_KIND.QUALIFICATION);

    await expect(service.getReadiness('correlation-id')).resolves.toEqual({
      dependencies: {
        discovery: BFF_DEPENDENCY_READINESS_STATUS.OK,
        qualification: BFF_DEPENDENCY_READINESS_STATUS.UNAVAILABLE,
      },
      status: BFF_DEPENDENCY_READINESS_STATUS.UNAVAILABLE,
    });
  });
});
