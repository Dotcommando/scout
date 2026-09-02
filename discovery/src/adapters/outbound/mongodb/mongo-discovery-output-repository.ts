import { Injectable, OnModuleInit } from '@nestjs/common';
import { Collection } from 'mongodb';

import { IDiscoveryOutputPayload } from '../../../app/discovery/discovery-output-payload.js';
import { DISCOVERY_OUTPUT_STATUS } from '../../../domain/discovery/discovery-model.js';
import {
  DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND,
  DISCOVERY_OUTPUT_SAVE_OUTCOME,
  IClaimedDiscoveryOutput,
  IClaimPendingDiscoveryOutputsInput,
  IConfirmDiscoveryOutputPublicationInput,
  IDiscoveryOutputRepositoryPort,
  IRecordDiscoveryOutputPublicationFailureInput,
  IReleaseDiscoveryOutputClaimInput,
  ISaveDiscoveryOutputInput,
} from '../../../ports/outbound/discovery-output-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface IDiscoveryOutputDocument {
  readonly campaignId: string;
  readonly createdAt: Date;
  readonly lastPublicationFailureKind?: DISCOVERY_OUTPUT_PUBLICATION_FAILURE_KIND;
  readonly lastPublicationFailureMessage?: string;
  readonly lastPublicationFailureOccurredAt?: Date;
  readonly lastPublicationFailureRetryable?: boolean;
  readonly leadId: string;
  readonly nextPublicationAttemptAt?: Date;
  readonly outputId: string;
  readonly payload?: IDiscoveryOutputPayload;
  readonly publicationConfirmedAt?: Date;
  readonly publisherClaimedAt?: Date;
  readonly publisherLeaseExpiresAt?: Date;
  readonly publisherWorkerId?: string;
  readonly publishAttemptCount?: number;
  readonly status: DISCOVERY_OUTPUT_STATUS;
  readonly updatedAt?: Date;
}

@Injectable()
export class MongoDiscoveryOutputRepository
  implements IDiscoveryOutputRepositoryPort, OnModuleInit {
  private readonly collection: Collection<IDiscoveryOutputDocument>;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    this.collection = mongoDatabaseClient
      .getDatabase()
      .collection('discovery_outputs');
  }

  public async claimPendingDiscoveryOutputs(
    input: IClaimPendingDiscoveryOutputsInput,
  ): Promise<readonly IClaimedDiscoveryOutput[]> {
    const claimedOutputs: IClaimedDiscoveryOutput[] = [];

    for (let index = 0; index < input.limit; index += 1) {
      const document = await this.collection.findOneAndUpdate(
        {
          payload: { $exists: true },
          $or: [
            {
              lastPublicationFailureRetryable: { $ne: false },
              nextPublicationAttemptAt: { $lte: input.retryEligibleAt },
              status: DISCOVERY_OUTPUT_STATUS.PENDING,
            },
            {
              lastPublicationFailureRetryable: { $ne: false },
              nextPublicationAttemptAt: { $exists: false },
              status: DISCOVERY_OUTPUT_STATUS.PENDING,
            },
            {
              publisherLeaseExpiresAt: { $lte: input.claimedAt },
              status: DISCOVERY_OUTPUT_STATUS.PUBLISHING,
            },
            {
              publisherLeaseExpiresAt: { $exists: false },
              status: DISCOVERY_OUTPUT_STATUS.PUBLISHING,
            },
          ],
        },
        {
          $inc: { publishAttemptCount: 1 },
          $set: {
            publisherClaimedAt: input.claimedAt,
            publisherLeaseExpiresAt: input.leaseExpiresAt,
            publisherWorkerId: input.workerId,
            status: DISCOVERY_OUTPUT_STATUS.PUBLISHING,
            updatedAt: input.claimedAt,
          },
          $unset: {
            nextPublicationAttemptAt: '',
          },
        },
        {
          returnDocument: 'after',
          sort: {
            createdAt: 1,
            outputId: 1,
          },
        },
      );

      if (document === null) {
        return claimedOutputs;
      }

      claimedOutputs.push(toClaimedDiscoveryOutput(document));
    }

    return claimedOutputs;
  }

  public async confirmDiscoveryOutputPublication(
    input: IConfirmDiscoveryOutputPublicationInput,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      {
        outputId: input.outputId,
        publisherWorkerId: input.workerId,
        status: DISCOVERY_OUTPUT_STATUS.PUBLISHING,
      },
      {
        $set: {
          publicationConfirmedAt: input.confirmedAt,
          status: DISCOVERY_OUTPUT_STATUS.PUBLISHED,
          updatedAt: input.confirmedAt,
        },
        $unset: {
          publisherClaimedAt: '',
          publisherLeaseExpiresAt: '',
          publisherWorkerId: '',
        },
      },
    );

    return result.modifiedCount === 1;
  }

  public async onModuleInit(): Promise<void> {
    await this.collection.createIndex(
      {
        campaignId: 1,
        leadId: 1,
      },
      {
        name: 'campaign_lead_output_unique',
        unique: true,
      },
    );
    await this.collection.createIndex(
      {
        outputId: 1,
      },
      {
        name: 'output_id_unique',
        unique: true,
      },
    );
    await this.collection.createIndex(
      {
        status: 1,
        nextPublicationAttemptAt: 1,
        createdAt: 1,
        outputId: 1,
      },
      {
        name: 'publication_pending_selection',
      },
    );
    await this.collection.createIndex(
      {
        status: 1,
        publisherLeaseExpiresAt: 1,
      },
      {
        name: 'publication_stale_lease_selection',
      },
    );
  }

  public async recordDiscoveryOutputPublicationFailure(
    input: IRecordDiscoveryOutputPublicationFailureInput,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      {
        outputId: input.outputId,
        publisherWorkerId: input.workerId,
        status: DISCOVERY_OUTPUT_STATUS.PUBLISHING,
      },
      {
        $set: {
          lastPublicationFailureKind: input.failure.kind,
          lastPublicationFailureMessage: input.failure.message,
          lastPublicationFailureOccurredAt: input.failure.occurredAt,
          lastPublicationFailureRetryable: input.failure.retryable,
          ...(input.failure.retryable
            ? { nextPublicationAttemptAt: input.nextAttemptAt }
            : {}),
          status: input.failure.retryable
            ? DISCOVERY_OUTPUT_STATUS.PENDING
            : DISCOVERY_OUTPUT_STATUS.FAILED,
          updatedAt: input.failure.occurredAt,
        },
        $unset: {
          ...(input.failure.retryable ? {} : { nextPublicationAttemptAt: '' }),
          publisherClaimedAt: '',
          publisherLeaseExpiresAt: '',
          publisherWorkerId: '',
        },
      },
    );

    return result.modifiedCount === 1;
  }

  public async releaseDiscoveryOutputClaim(
    input: IReleaseDiscoveryOutputClaimInput,
  ): Promise<boolean> {
    const result = await this.collection.updateOne(
      {
        outputId: input.outputId,
        publisherWorkerId: input.workerId,
        status: DISCOVERY_OUTPUT_STATUS.PUBLISHING,
      },
      {
        $set: {
          status: DISCOVERY_OUTPUT_STATUS.PENDING,
          updatedAt: input.releasedAt,
        },
        $unset: {
          publisherClaimedAt: '',
          publisherLeaseExpiresAt: '',
          publisherWorkerId: '',
        },
      },
    );

    return result.modifiedCount === 1;
  }

  public async saveDiscoveryOutput(
    input: ISaveDiscoveryOutputInput,
  ): Promise<DISCOVERY_OUTPUT_SAVE_OUTCOME> {
    const result = await this.collection.updateOne(
      {
        campaignId: input.campaignId,
        leadId: input.leadId,
      },
      {
        $setOnInsert: {
          ...input,
          publishAttemptCount: 0,
          updatedAt: input.createdAt,
        },
      },
      {
        upsert: true,
      },
    );

    return result.upsertedCount === 1
      ? DISCOVERY_OUTPUT_SAVE_OUTCOME.INSERTED
      : DISCOVERY_OUTPUT_SAVE_OUTCOME.EXISTING;
  }
}

function toClaimedDiscoveryOutput(
  document: IDiscoveryOutputDocument,
): IClaimedDiscoveryOutput {
  return {
    campaignId: document.campaignId,
    leadId: document.leadId,
    outputId: document.outputId,
    payload: document.payload,
    publishAttemptCount: document.publishAttemptCount ?? 1,
  };
}
