import { jest } from '@jest/globals';
import { MongoClient } from 'mongodb';

import { DiscoveryRuntimeConfiguration } from '../../inbound/bootstrap/discovery-runtime-configuration.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

describe('MongoDatabaseClient', () => {
  it('surfaces a controlled unavailable-database failure', async () => {
    const connect = jest
      .spyOn(MongoClient.prototype, 'connect')
      .mockRejectedValue(new Error('MongoDB unavailable'));
    const databaseClient = new MongoDatabaseClient(
      new DiscoveryRuntimeConfiguration(),
    );

    await expect(databaseClient.onModuleInit()).rejects.toThrow(
      'MongoDB unavailable',
    );

    connect.mockRestore();
  });
});
