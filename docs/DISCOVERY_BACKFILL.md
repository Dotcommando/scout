# Discovery backfill procedure

Use the Discovery backfill command only to submit canonical leads that already
exist in Discovery storage. The command never publishes directly to RabbitMQ:
it creates normal `discovery_outputs` records and the existing publisher
delivers them with its ordinary retry and recovery behaviour.

## Select the target

Choose the configured Discovery campaign explicitly. Do not infer a campaign
from a deleted output or from a Qualification record. The selection requires:

- `--campaign-id`: the configured Discovery campaign ID;
- `--source-kind`: the authoritative source to select;
- `--maximum-lead-count`: an explicit bounded selection size;
- `--lead-id-prefix` (optional): restricts selection to canonical lead IDs with
  that literal prefix, useful for a controlled subset;
- `--run-id`: an operator-generated stable run ID used to resume an interrupted
  run;
- `--qualification-catalog-revision`: the revision in
  `config/qualification/known-affiliations.yaml` being used for the associated
  Qualification run.

Read the catalog revision from the `revision` field. The value is audit context
only; Discovery does not load Qualification's configuration or persistence.

## Preview and run

Build Discovery first, then preview the exact bounded selection:

```powershell
docker compose exec discovery npm run backfill -- `
  --campaign-id europe-gb-ie `
  --source-kind google-maps `
  --lead-id-prefix step6-backfill- `
  --maximum-lead-count 100 `
  --qualification-catalog-revision 2026-09-02-r1 `
  --run-id backfill-2026-09-02-a `
  --dry-run
```

Run the same selection without `--dry-run` and with `--confirm` only after the
preview is accepted. Use a new run ID: dry-run and execution are separate
auditable operations.

```powershell
docker compose exec discovery npm run backfill -- `
  --campaign-id europe-gb-ie `
  --source-kind google-maps `
  --lead-id-prefix step6-backfill- `
  --maximum-lead-count 100 `
  --qualification-catalog-revision 2026-09-02-r1 `
  --run-id backfill-2026-09-02-a-apply `
  --confirm
```

The `discovery_backfill_runs` record contains campaign, selection, Discovery
configuration hash, Qualification catalog revision, counts, timestamps and
outcome. `runId` may be reused after an interruption only with the same mode,
campaign, selection and revisions. A completed run with the same ID returns its
stored audited result.

## Monitor and reconcile

Monitor the backfill record plus the normal delivery path:

1. Confirm the run reaches `completed` in `discovery_backfill_runs`.
2. Inspect the corresponding pending or published `discovery_outputs` records;
   their payload origin is `backfill` and their `backfillRunId` is the run ID.
3. Monitor Discovery publisher logs and the RabbitMQ Discovery, retry and DLQ
   queues using the procedures in `RABBITMQ_TRANSPORT_CONTRACT.md`.
4. Monitor Qualification logs and its durable execution/decision records.
5. Reconcile the run's selected count against Qualification execution and
   decision counts. Investigate retries or DLQ messages rather than injecting a
   broker message manually.

Outbox identity is deterministic by campaign and lead. Repeating a run, or
resuming after a crash, cannot create a second output for the same campaign and
lead. Backfill payloads are current canonical snapshots stamped at backfill
time; they do not claim to reconstruct the historical discovery event.
