import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

import { Injectable, OnModuleInit } from '@nestjs/common';
import {
  ACTOR_GATEWAY_SCHEMA_VERSION,
  ACTOR_REQUEST_STATUS,
  IActorGatewayArchiveManifest,
  IActorGatewayRequestStatus,
  IActorGatewayResolveRequest,
  parseActorGatewayResolveRequest,
} from '@scout/contracts';
import {
  Collection,
  GridFSBucket,
  MongoServerError,
} from 'mongodb';

import {
  ICanonicalActorRequest,
} from '../../../domain/actor/actor-request.js';
import { buildObservedFieldCatalogue } from '../../../domain/actor/observed-field-catalogue.js';
import {
  ACTOR_EXECUTION_CLAIM_OUTCOME,
  IActorArchiveRecord,
  IActorExecutionClaim,
  IActorRequestRepositoryPort,
  IObservedActorField,
} from '../../../ports/outbound/actor-request-repository.port.js';
import { MongoDatabaseClient } from './mongo-database-client.js';

interface IActorRequestDocument {
  readonly archiveId?: string;
  readonly actorDefinitionId: string;
  readonly actorRevision: string;
  readonly cachePolicyRevision: string;
  readonly canonicalInput: string;
  readonly execution?: IActorExecutionDocument;
  readonly correlationId: string;
  readonly createdAt: Date;
  readonly requestId: string;
  readonly reusableUntil: Date;
  readonly reuseKey: string;
  readonly status: ACTOR_REQUEST_STATUS;
  readonly updatedAt: Date;
}

interface IActorExecutionDocument {
  readonly attempt: number;
  readonly claimedAt: Date;
  readonly providerRunId?: string;
  readonly startInvokedAt?: Date;
}

interface IActorArchiveDocument {
  readonly archiveId: string;
  readonly byteLength: number;
  readonly contentEncoding: string;
  readonly contentType: string;
  readonly gridFsFileId: string;
  readonly recordBoundaryIndex: readonly number[];
  readonly requestId: string;
  readonly runId: string;
  readonly sha256: string;
  readonly storedAt: Date;
}

interface IObservedActorFieldDocument {
  readonly actorDefinitionId: string;
  readonly actorRevision: string;
  readonly firstObservedArchiveId: string;
  readonly jsonPointer: string;
  readonly lastObservedArchiveId: string;
  readonly lastObservedAt: Date;
  readonly nonNullRecordCount: number;
  readonly observedValueKinds: readonly string[];
  readonly presentRecordCount: number;
  readonly recordKind: string;
}

@Injectable()
export class MongoActorRequestRepository
  implements IActorRequestRepositoryPort, OnModuleInit {
  private readonly archiveCollection: Collection<IActorArchiveDocument>;
  private readonly fieldCollection: Collection<IObservedActorFieldDocument>;
  private readonly requestCollection: Collection<IActorRequestDocument>;
  private readonly archiveBucket: GridFSBucket;

  public constructor(mongoDatabaseClient: MongoDatabaseClient) {
    const database = mongoDatabaseClient.getDatabase();

    this.archiveBucket = new GridFSBucket(database, { bucketName: 'actor_archives' });
    this.archiveCollection = database.collection('actor_archive_manifests');
    this.fieldCollection = database.collection('actor_observed_fields');
    this.requestCollection = database.collection('actor_requests');
  }

  public async findArchiveContent(archiveId: string): Promise<Uint8Array | null> {
    const archive = await this.archiveCollection.findOne({ archiveId });

    if (archive === null) {
      return null;
    }

    const chunks: Buffer[] = [];
    const stream = this.archiveBucket.openDownloadStreamByName(archive.gridFsFileId);

    await new Promise<void>((resolve, reject) => {
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', resolve);
      stream.on('error', reject);
    });

    const content = Buffer.concat(chunks);
    const checksum = createHash('sha256').update(content).digest('hex');

    if (checksum !== archive.sha256) {
      throw new Error(`actor archive integrity check failed: ${archiveId}`);
    }

    return content;
  }

  public async claimExecution(
    requestId: string,
    claimedAt: string,
    staleBefore: string,
  ): Promise<IActorExecutionClaim> {
    const claimTime = new Date(claimedAt);
    const staleTime = new Date(staleBefore);
    const existing = await this.requestCollection.findOne({ requestId });

    if (existing === null) {
      throw new Error(`actor request was not found: ${requestId}`);
    }
    if (
      existing.status === ACTOR_REQUEST_STATUS.SUCCEEDED
      || existing.status === ACTOR_REQUEST_STATUS.FAILED
    ) {
      return {
        attempt: existing.execution?.attempt ?? 0,
        outcome: ACTOR_EXECUTION_CLAIM_OUTCOME.TERMINAL,
        status: toRequestStatus(existing),
      };
    }
    if (
      existing.status === ACTOR_REQUEST_STATUS.RUNNING
      && existing.execution?.claimedAt !== undefined
      && existing.execution.claimedAt > staleTime
    ) {
      return {
        attempt: existing.execution.attempt,
        outcome: ACTOR_EXECUTION_CLAIM_OUTCOME.IN_PROGRESS,
        status: toRequestStatus(existing),
      };
    }
    if (
      existing.status === ACTOR_REQUEST_STATUS.RUNNING
      && existing.execution?.startInvokedAt !== undefined
      && existing.execution.providerRunId === undefined
    ) {
      return {
        attempt: existing.execution.attempt,
        outcome: ACTOR_EXECUTION_CLAIM_OUTCOME.UNKNOWN_START_OUTCOME,
        status: toRequestStatus(existing),
      };
    }

    const nextAttempt = (existing.execution?.attempt ?? 0) + 1;
    const result = await this.requestCollection.findOneAndUpdate(
      {
        requestId,
        status: { $in: [ACTOR_REQUEST_STATUS.PENDING, ACTOR_REQUEST_STATUS.RUNNING] },
        ...(existing.status === ACTOR_REQUEST_STATUS.RUNNING
          ? { 'execution.claimedAt': { $lte: staleTime } }
          : {}),
      },
      {
        $set: {
          execution: {
            attempt: nextAttempt,
            claimedAt: claimTime,
            ...(existing.execution?.providerRunId === undefined
              ? { startInvokedAt: claimTime }
              : { providerRunId: existing.execution.providerRunId }),
          },
          status: ACTOR_REQUEST_STATUS.RUNNING,
          updatedAt: claimTime,
        },
      },
      { returnDocument: 'after' },
    );

    if (result === null) {
      const concurrent = await this.findRequestStatus(requestId);

      if (concurrent === null) {
        throw new Error(`actor request was not found after execution claim: ${requestId}`);
      }

      return {
        attempt: existing.execution?.attempt ?? 0,
        outcome: ACTOR_EXECUTION_CLAIM_OUTCOME.IN_PROGRESS,
        status: concurrent,
      };
    }

    return {
      attempt: nextAttempt,
      outcome: ACTOR_EXECUTION_CLAIM_OUTCOME.CLAIMED,
      ...(result.execution?.providerRunId === undefined
        ? {}
        : { providerRunId: result.execution.providerRunId }),
      status: toRequestStatus(result),
    };
  }

  public async findArchiveManifest(
    archiveId: string,
  ): Promise<IActorGatewayArchiveManifest | null> {
    const archive = await this.archiveCollection.findOne({ archiveId });

    return archive === null ? null : toArchiveManifest(archive);
  }

  public async findOrCreateRequest(
    request: ICanonicalActorRequest,
  ): Promise<IActorGatewayRequestStatus> {
    const existing = await this.requestCollection.findOne({ reuseKey: request.reuseKey });

    if (existing !== null) {
      return toRequestStatus(existing);
    }

    const document = createRequestDocument(request);

    try {
      await this.requestCollection.insertOne(document);

      return toRequestStatus(document);
    } catch (error: unknown) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }

      const concurrentRequest = await this.requestCollection.findOne({
        reuseKey: request.reuseKey,
      });

      if (concurrentRequest === null) {
        throw new Error('actor request uniqueness conflict has no durable record');
      }

      return toRequestStatus(concurrentRequest);
    }
  }

  public async findRequestStatus(
    requestId: string,
  ): Promise<IActorGatewayRequestStatus | null> {
    const request = await this.requestCollection.findOne({ requestId });

    return request === null ? null : toRequestStatus(request);
  }

  public async findRequestExecutionInput(
    requestId: string,
  ): Promise<IActorGatewayResolveRequest | null> {
    const request = await this.requestCollection.findOne({ requestId });

    if (request === null) {
      return null;
    }

    return parseActorGatewayResolveRequest({
      actorDefinitionId: request.actorDefinitionId,
      actorRevision: request.actorRevision,
      cachePolicyRevision: request.cachePolicyRevision,
      canonicalInput: parseCanonicalInput(request.canonicalInput),
      correlationId: request.correlationId,
      requestedAt: request.createdAt.toISOString(),
      schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
    });
  }

  public async findObservedFields(
    actorDefinitionId: string,
    pathFragment: string,
  ): Promise<readonly IObservedActorField[]> {
    const documents = await this.fieldCollection.find({
      actorDefinitionId,
      jsonPointer: { $regex: escapeRegularExpression(pathFragment), $options: 'i' },
    }).toArray();

    return documents.map((document) => ({
      ...document,
      lastObservedAt: document.lastObservedAt.toISOString(),
    }));
  }

  public async onModuleInit(): Promise<void> {
    await this.requestCollection.createIndex(
      { reuseKey: 1 },
      { name: 'actor_request_reuse_key_unique', unique: true },
    );
    await this.requestCollection.createIndex(
      { requestId: 1 },
      { name: 'actor_request_id_unique', unique: true },
    );
    await this.archiveCollection.createIndex(
      { archiveId: 1 },
      { name: 'actor_archive_id_unique', unique: true },
    );
    await this.fieldCollection.createIndex(
      {
        actorDefinitionId: 1,
        actorRevision: 1,
        jsonPointer: 1,
        recordKind: 1,
      },
      { name: 'actor_observed_field_unique', unique: true },
    );
  }

  public async markRequestSucceeded(
    requestId: string,
    archiveId: string,
    updatedAt: string,
  ): Promise<IActorGatewayRequestStatus> {
    const result = await this.requestCollection.findOneAndUpdate(
      { requestId },
      {
        $set: {
          archiveId,
          status: ACTOR_REQUEST_STATUS.SUCCEEDED,
          updatedAt: new Date(updatedAt),
        },
      },
      { returnDocument: 'after' },
    );

    if (result === null) {
      throw new Error(`actor request was not found: ${requestId}`);
    }

    return toRequestStatus(result);
  }

  public async markRequestFailed(
    requestId: string,
    updatedAt: string,
  ): Promise<IActorGatewayRequestStatus> {
    return this.updateRequestStatus(
      requestId,
      ACTOR_REQUEST_STATUS.FAILED,
      updatedAt,
    );
  }

  public async recordProviderRun(
    requestId: string,
    providerRunId: string,
    updatedAt: string,
  ): Promise<IActorGatewayRequestStatus> {
    const result = await this.requestCollection.findOneAndUpdate(
      {
        requestId,
        status: ACTOR_REQUEST_STATUS.RUNNING,
      },
      {
        $set: {
          'execution.providerRunId': providerRunId,
          updatedAt: new Date(updatedAt),
        },
      },
      { returnDocument: 'after' },
    );

    if (result === null) {
      throw new Error(`running actor request was not found: ${requestId}`);
    }

    return toRequestStatus(result);
  }

  public async saveArchive(
    archive: IActorArchiveRecord,
  ): Promise<IActorGatewayArchiveManifest> {
    const compressedContent = gzipSync(archive.content);
    const sha256 = createHash('sha256').update(compressedContent).digest('hex');
    const fileId = crypto.randomUUID();
    const upload = this.archiveBucket.openUploadStream(fileId, {
      metadata: { archiveId: archive.archiveId },
    });

    await new Promise<void>((resolve, reject) => {
      upload.on('error', reject);
      upload.on('finish', resolve);
      upload.end(compressedContent);
    });

    const document: IActorArchiveDocument = {
      archiveId: archive.archiveId,
      byteLength: compressedContent.byteLength,
      contentEncoding: 'gzip',
      contentType: archive.contentType,
      gridFsFileId: fileId,
      recordBoundaryIndex: archive.recordBoundaryIndex,
      requestId: archive.requestId,
      runId: archive.runId,
      sha256,
      storedAt: new Date(archive.storedAt),
    };

    await this.archiveCollection.insertOne(document);
    await this.saveObservedFields(archive);

    return toArchiveManifest(document);
  }

  private async updateRequestStatus(
    requestId: string,
    status: ACTOR_REQUEST_STATUS,
    updatedAt: string,
  ): Promise<IActorGatewayRequestStatus> {
    const result = await this.requestCollection.findOneAndUpdate(
      { requestId },
      {
        $set: {
          status,
          updatedAt: new Date(updatedAt),
        },
      },
      { returnDocument: 'after' },
    );

    if (result === null) {
      throw new Error(`actor request was not found: ${requestId}`);
    }

    return toRequestStatus(result);
  }

  private async saveObservedFields(
    archive: IActorArchiveRecord,
  ): Promise<void> {
    const records = readArchiveRecords(archive.content);
    const fields = buildObservedFieldCatalogue(
      archive.actorDefinitionId,
      archive.actorRevision,
      archive.archiveId,
      archive.storedAt,
      records,
    );

    await Promise.all(fields.map((field) => this.fieldCollection.updateOne(
      {
        actorDefinitionId: field.actorDefinitionId,
        actorRevision: field.actorRevision,
        jsonPointer: field.jsonPointer,
        recordKind: field.recordKind,
      },
      {
        $addToSet: { observedValueKinds: { $each: [...field.observedValueKinds] } },
        $inc: {
          nonNullRecordCount: field.nonNullRecordCount,
          presentRecordCount: field.presentRecordCount,
        },
        $set: {
          lastObservedArchiveId: field.lastObservedArchiveId,
          lastObservedAt: new Date(field.lastObservedAt),
        },
        $setOnInsert: {
          firstObservedArchiveId: field.firstObservedArchiveId,
        },
      },
      { upsert: true },
    )));
  }
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readArchiveRecords(content: Uint8Array): readonly unknown[] {
  const parsed: unknown = JSON.parse(new TextDecoder().decode(content));

  if (!Array.isArray(parsed)) {
    throw new Error('actor archive content must be a JSON array of records');
  }

  return parsed;
}

function parseCanonicalInput(canonicalInput: string): unknown {
  try {
    const parsed: unknown = JSON.parse(canonicalInput);

    return parsed;
  } catch (error: unknown) {
    throw new Error('persisted actor canonical input is invalid JSON', { cause: error });
  }
}

function createRequestDocument(request: ICanonicalActorRequest): IActorRequestDocument {
  const createdAt = new Date(request.createdAt);

  return {
    actorDefinitionId: request.input.actorDefinitionId,
    actorRevision: request.input.actorRevision,
    cachePolicyRevision: request.input.cachePolicyRevision,
    canonicalInput: request.canonicalInput,
    correlationId: request.input.correlationId,
    createdAt,
    requestId: request.requestId,
    reusableUntil: new Date(request.reusableUntil),
    reuseKey: request.reuseKey,
    status: ACTOR_REQUEST_STATUS.PENDING,
    updatedAt: createdAt,
  };
}

function isDuplicateKeyError(error: unknown): boolean {
  return error instanceof MongoServerError && error.code === 11000;
}

function toArchiveManifest(
  archive: IActorArchiveDocument,
): IActorGatewayArchiveManifest {
  return {
    archiveId: archive.archiveId,
    byteLength: archive.byteLength,
    contentEncoding: archive.contentEncoding,
    contentType: archive.contentType,
    requestId: archive.requestId,
    runId: archive.runId,
    schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
    sha256: archive.sha256,
    storedAt: archive.storedAt.toISOString(),
  };
}

function toRequestStatus(
  request: IActorRequestDocument,
): IActorGatewayRequestStatus {
  return {
    actorDefinitionId: request.actorDefinitionId,
    actorRevision: request.actorRevision,
    ...(request.archiveId === undefined ? {} : { archiveId: request.archiveId }),
    correlationId: request.correlationId,
    createdAt: request.createdAt.toISOString(),
    requestId: request.requestId,
    schemaVersion: ACTOR_GATEWAY_SCHEMA_VERSION.V1,
    status: request.status,
    updatedAt: request.updatedAt.toISOString(),
  };
}
