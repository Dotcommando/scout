import { connect } from 'amqplib';
import { Collection, Document } from 'mongodb';

import {
  QUALIFICATION_DECISION,
  QUALIFICATION_EXECUTION_STATUS,
  QUALIFICATION_INPUT_STATUS,
} from '../../../domain/qualification/qualification-model.js';
import { MongoDatabaseClient } from '../../outbound/mongodb/mongo-database-client.js';
import { QualificationRuntimeConfiguration } from '../bootstrap/qualification-runtime-configuration.js';
import {
  writeQualificationFailureLog,
  writeQualificationLog,
} from '../bootstrap/qualification-structured-logger.js';

const QUALIFICATION_QUEUE_NAMES = [
  'qualification.discovered-lead.v1',
  'qualification.discovered-lead.v1.retry.30s',
  'qualification.discovered-lead.v1.retry.5m',
  'qualification.discovered-lead.v1.dead-letter',
];

interface IQueueSummary {
  readonly consumers: number;
  readonly messages: number;
  readonly queue: string;
}

interface IStatusCount {
  readonly count: number;
  readonly status: string;
}

async function main(): Promise<void> {
  const correlationId = crypto.randomUUID();
  const runtimeConfiguration = new QualificationRuntimeConfiguration();
  const databaseClient = new MongoDatabaseClient(runtimeConfiguration);

  await databaseClient.onModuleInit();

  try {
    const database = databaseClient.getDatabase();
    const [decisions, executions, inputs, queues] = await Promise.all([
      countByField(
        database.collection('qualification_decisions'),
        'decision.decision',
        QUALIFICATION_DECISION_ARRAY,
      ),
      countByField(
        database.collection('qualification_executions'),
        'status',
        QUALIFICATION_EXECUTION_STATUS_ARRAY,
      ),
      countByField(
        database.collection('qualification_inbox'),
        'status',
        QUALIFICATION_INPUT_STATUS_ARRAY,
      ),
      inspectQueues(runtimeConfiguration.rabbitmqUri),
    ]);

    writeQualificationLog({
      className: 'ReportQualificationOperationsCommand',
      correlationId,
      input: { decisions, executions, inputs, queues },
      level: 'info',
      method: 'main',
      operation: 'report-qualification-operations',
      retryable: false,
      service: 'qualification',
    });
  } finally {
    await databaseClient.onModuleDestroy();
  }
}

const QUALIFICATION_DECISION_ARRAY = Object.values(QUALIFICATION_DECISION);
const QUALIFICATION_EXECUTION_STATUS_ARRAY = Object.values(
  QUALIFICATION_EXECUTION_STATUS,
);
const QUALIFICATION_INPUT_STATUS_ARRAY = Object.values(
  QUALIFICATION_INPUT_STATUS,
);

async function countByField(
  collection: Collection<Document>,
  fieldName: string,
  statuses: readonly string[],
): Promise<readonly IStatusCount[]> {
  return Promise.all(
    statuses.map(async (status) => ({
      count: await collection.countDocuments({ [fieldName]: status }),
      status,
    })),
  );
}

async function inspectQueues(
  rabbitmqUri: string,
): Promise<readonly IQueueSummary[]> {
  const connection = await connect(rabbitmqUri);

  try {
    const channel = await connection.createChannel();

    try {
      return await Promise.all(
        QUALIFICATION_QUEUE_NAMES.map(async (queue) => {
          const state = await channel.checkQueue(queue);

          return {
            consumers: state.consumerCount,
            messages: state.messageCount,
            queue,
          };
        }),
      );
    } finally {
      await channel.close();
    }
  } finally {
    await connection.close();
  }
}

void main().catch((error: unknown) => {
  writeQualificationFailureLog({
    className: 'ReportQualificationOperationsCommand',
    correlationId: crypto.randomUUID(),
    error,
    method: 'main',
    operation: 'report-qualification-operations',
    retryable: true,
  });
  process.exitCode = 1;
});
