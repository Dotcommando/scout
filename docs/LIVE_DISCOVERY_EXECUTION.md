# Controlled live Discovery execution

The normal Discovery service never starts an Apify Actor. The only supported
paid path is the explicit `npm run live:execute` command with `--confirm`.
Ordinary tests, builds, scheduler ticks and RabbitMQ processing stay offline.

Use a unique execution ID and select one approved purpose:

```powershell
docker compose exec discovery npm run live:execute -- `
  --execution-id preflight-2026-09-02-a `
  --purpose preflight `
  --confirm
```

The first execution must use `preflight`, capped at 20 provider items. A later
explicit approved collection uses `--purpose approved-collection`, capped at
100 items per Actor run. The persistent configuration additionally limits the
plan to 600 provider items and seven Actor runs. Normal planned collection is
also capped at 100 items per calendar day.

Each imported provider page writes a durable cumulative yield record and an
immutable JSON artifact below:

```text
artifacts/discovery-live-executions/<execution-id>/batch-<sequence>.json
```

These artifacts are intentionally excluded from Git. Once at least 200
provider items have been downloaded, an execution pauses when its cumulative
unique-lead rate is at or below 0.5%. The rate is persisted and logged as
inserted source identities divided by downloaded provider items. A paused
execution cannot reserve another paid Actor run. Artifact-write failure also
pauses the execution before another paid run can begin.

Do not delete leads, outbox records, live-execution records, or artifacts to
work around a pause. Investigate the audit record, then create a separately
approved execution after documenting a new allowance/override.
