import { createConnection } from 'node:net';

import { Injectable } from '@nestjs/common';

import { DiscoveryRuntimeConfiguration } from '../../inbound/bootstrap/discovery-runtime-configuration.js';

const DEFAULT_AMQP_PORT = 5672;
const DEFAULT_AMQPS_PORT = 5671;

@Injectable()
export class RabbitMqConnectionVerifier {
  public constructor(
    private readonly runtimeConfiguration: DiscoveryRuntimeConfiguration,
  ) {}

  public async verifyConnection(): Promise<void> {
    const uri = new URL(this.runtimeConfiguration.rabbitmqUri);
    const port = resolvePort(uri);

    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ host: uri.hostname, port });
      let completed = false;
      const complete = (error: Error | undefined): void => {
        if (completed) {
          return;
        }

        completed = true;
        socket.destroy();

        if (error === undefined) {
          resolve();

          return;
        }

        reject(error);
      };

      socket.once('connect', () => complete(undefined));
      socket.once('error', (error: Error) => complete(error));
      socket.setTimeout(this.runtimeConfiguration.rabbitmqConnectionTimeoutMs);
      socket.once('timeout', () =>
        complete(
          new Error(
            `RabbitMQ TCP readiness probe timed out after ${this.runtimeConfiguration.rabbitmqConnectionTimeoutMs}ms`,
          ),
        ),
      );
    });
  }
}

function resolvePort(uri: URL): number {
  if (uri.port.length > 0) {
    return Number(uri.port);
  }

  return uri.protocol === 'amqps:' ? DEFAULT_AMQPS_PORT : DEFAULT_AMQP_PORT;
}
