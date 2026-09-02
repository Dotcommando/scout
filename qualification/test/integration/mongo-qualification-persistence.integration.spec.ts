import { QualificationRuntimeConfiguration } from '../../src/adapters/inbound/bootstrap/qualification-runtime-configuration.js';
import { MongoDatabaseClient } from '../../src/adapters/outbound/mongodb/mongo-database-client.js';
import { MongoQualificationDecisionRepository } from '../../src/adapters/outbound/mongodb/mongo-qualification-decision-repository.js';
import { MongoQualificationExecutionRepository } from '../../src/adapters/outbound/mongodb/mongo-qualification-execution-repository.js';
import { MongoQualificationInboxRepository } from '../../src/adapters/outbound/mongodb/mongo-qualification-inbox-repository.js';
import { MongoQualifiedLeadOutputRepository } from '../../src/adapters/outbound/mongodb/mongo-qualified-lead-output-repository.js';
import {
  KNOWN_AFFILIATION_MATCH_STRATEGY,
  QUALIFICATION_DECISION,
  QUALIFICATION_EXECUTION_STATUS,
  QUALIFICATION_INPUT_STATUS,
  QUALIFICATION_REASON_CODE,
  QUALIFICATION_RULE_KIND,
  QualificationDecision,
  QualificationReason,
  QUALIFIED_OUTPUT_STATUS,
} from '../../src/domain/qualification/qualification-model.js';
import { QUALIFICATION_EXECUTION_CLAIM_OUTCOME } from '../../src/ports/outbound/qualification-execution-repository.port.js';

const INTEGRATION_DATABASE_URI =
  'mongodb://localhost:27017/scout_qualification_step3_integration';

describe('Mongo Qualification persistence', () => {
  let databaseClient: MongoDatabaseClient;
  let decisionRepository: MongoQualificationDecisionRepository;
  let executionRepository: MongoQualificationExecutionRepository;
  let inboxRepository: MongoQualificationInboxRepository;
  let outputRepository: MongoQualifiedLeadOutputRepository;
  let previousMongoDbUri: string | undefined;

  beforeAll(async () => {
    previousMongoDbUri = process.env.QUALIFICATION_MONGODB_URI;
    process.env.QUALIFICATION_MONGODB_URI = INTEGRATION_DATABASE_URI;
    databaseClient = new MongoDatabaseClient(new QualificationRuntimeConfiguration());
    await databaseClient.onModuleInit();
    await databaseClient.getDatabase().dropDatabase();

    decisionRepository = new MongoQualificationDecisionRepository(databaseClient);
    executionRepository = new MongoQualificationExecutionRepository(databaseClient);
    inboxRepository = new MongoQualificationInboxRepository(databaseClient);
    outputRepository = new MongoQualifiedLeadOutputRepository(databaseClient);

    await Promise.all([
      decisionRepository.onModuleInit(),
      executionRepository.onModuleInit(),
      inboxRepository.onModuleInit(),
      outputRepository.onModuleInit(),
    ]);
  });

  afterAll(async () => {
    await databaseClient.getDatabase().dropDatabase();
    await databaseClient.onModuleDestroy();

    if (previousMongoDbUri === undefined) {
      delete process.env.QUALIFICATION_MONGODB_URI;

      return;
    }

    process.env.QUALIFICATION_MONGODB_URI = previousMongoDbUri;
  });

  it('enforces event, decision, and delivery-ready output idempotency', async () => {
    const recordedAt = new Date('2026-09-02T00:00:00.000Z');
    const input = {
      campaignId: 'campaign-records',
      correlationId: 'correlation-1',
      eventId: 'event-1',
      lead: {
        externalId: 'external-1',
        leadId: 'lead-1',
        name: 'Example lead',
        sourceKind: 'directory',
      },
      occurredAt: recordedAt,
      receivedAt: recordedAt,
      status: QUALIFICATION_INPUT_STATUS.RECEIVED,
    };
    const decision = new QualificationDecision(
      QUALIFICATION_DECISION.QUALIFIED,
      [
        new QualificationReason(
          QUALIFICATION_REASON_CODE.QUALIFICATION_RULES_SATISFIED,
          QUALIFICATION_RULE_KIND.REQUIRED_NAME,
          {
            catalogEntryId: 'catalog-entry-1',
            catalogRevision: 'catalog-r1',
            matchStrategy: KNOWN_AFFILIATION_MATCH_STRATEGY.EXACT_TOKEN_SEQUENCE_NAME,
          },
        ),
      ],
    );

    await inboxRepository.recordInput(input);
    await inboxRepository.recordInput({ ...input, correlationId: 'changed' });
    await decisionRepository.saveDecision({
      campaignId: input.campaignId,
      decision,
      eventId: input.eventId,
      lead: input.lead,
      profileContentHash: 'profile-hash',
      profileId: 'baseline',
      profileVersion: 1,
      recordedAt,
    });
    await decisionRepository.saveDecision({
      campaignId: input.campaignId,
      decision,
      eventId: 'event-2',
      lead: input.lead,
      profileContentHash: 'changed-profile-hash',
      profileId: 'changed',
      profileVersion: 1,
      recordedAt,
    });
    await outputRepository.saveQualifiedLeadOutput({
      campaignId: input.campaignId,
      createdAt: recordedAt,
      decisionEventId: input.eventId,
      lead: input.lead,
      outputId: 'output-1',
      profileVersion: 1,
      status: QUALIFIED_OUTPUT_STATUS.READY,
    });
    await outputRepository.saveQualifiedLeadOutput({
      campaignId: input.campaignId,
      createdAt: recordedAt,
      decisionEventId: 'event-2',
      lead: input.lead,
      outputId: 'output-2',
      profileVersion: 1,
      status: QUALIFIED_OUTPUT_STATUS.READY,
    });

    expect(
      await databaseClient.getDatabase().collection('qualification_inbox').countDocuments(),
    ).toBe(1);
    expect(
      await databaseClient.getDatabase().collection('qualification_decisions').countDocuments(),
    ).toBe(1);
    expect(
      await databaseClient.getDatabase().collection('qualified_lead_outputs').countDocuments(),
    ).toBe(1);
    expect((await decisionRepository.findDecision(
      input.campaignId,
      input.lead.leadId,
      1,
    ))?.decision.reasons[0]?.context).toEqual({
      catalogEntryId: 'catalog-entry-1',
      catalogRevision: 'catalog-r1',
      matchStrategy: KNOWN_AFFILIATION_MATCH_STRATEGY.EXACT_TOKEN_SEQUENCE_NAME,
    });
  });

  it('atomically assigns one profile execution to concurrent workers', async () => {
    const claims = await Promise.all(
      ['worker-a', 'worker-b', 'worker-c'].map((workerId) =>
        executionRepository.claimExecution({
          campaignId: 'campaign-execution',
          claimedAt: new Date('2026-09-02T01:00:00.000Z'),
          leadId: 'lead-1',
          profileVersion: 1,
          staleClaimBefore: new Date('2026-09-02T00:55:00.000Z'),
          workerId,
        }),
      ),
    );

    expect(
      claims.filter(
        (claim) => claim === QUALIFICATION_EXECUTION_CLAIM_OUTCOME.CLAIMED,
      ),
    ).toHaveLength(1);
    expect(
      await databaseClient
        .getDatabase()
        .collection('qualification_executions')
        .countDocuments({ status: QUALIFICATION_EXECUTION_STATUS.PROCESSING }),
    ).toBe(1);
  });
});
