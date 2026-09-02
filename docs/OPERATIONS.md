# Local operations runbook

## Start, stop, and health

Start the local stack with `docker compose up -d --build`. Stop it with
`docker compose stop`; this sends Docker's normal termination signal and keeps
MongoDB and RabbitMQ persistent state intact. Do not delete MongoDB or RabbitMQ
volumes for ordinary recovery.

Each service exposes two separate checks:

```powershell
Invoke-WebRequest http://localhost:3001/health/live
Invoke-WebRequest http://localhost:3001/health/ready
Invoke-WebRequest http://localhost:3002/health/live
Invoke-WebRequest http://localhost:3002/health/ready
```

`live` means the process is running. `ready` additionally verifies MongoDB and
RabbitMQ; a dependency failure returns HTTP 503 and a structured error log.

## Message recovery

Discovery retains every delivery candidate in `discovery_outputs`. A publisher
claim is lease-based; after a process or broker restart, expired publishing
claims become eligible for the normal publisher again. Do not insert broker
messages by hand. Inspect the output record, its attempt count, status and last
failure before restarting Discovery.

Qualification treats incoming events as at-least-once. Its inbox/execution and
decision uniqueness keys prevent a repeated message from creating a second
qualification for the same campaign, lead and profile version. A stopped
Qualification service leaves messages safely queued until it returns.

Inspect queues and service logs locally:

```powershell
docker compose logs --tail 200 discovery
docker compose logs --tail 200 qualification
docker compose exec rabbitmq rabbitmqctl list_queues name messages consumers
docker compose exec discovery npm run operations:summary
docker compose exec qualification npm run operations:summary
```

The retry queues are `qualification.discovered-lead.v1.retry.30s` and
`qualification.discovered-lead.v1.retry.5m`; poison or malformed messages end
in `qualification.discovered-lead.v1.dead-letter`. The summary commands emit
structured counts for the Discovery outbox and backfills, Qualification inbox,
executions and decisions, and the main/retry/dead-letter queues. Investigate the structured context
and correct the producer/configuration before replaying through an approved
application path.

## Backfill and configuration changes

Follow [Discovery backfill](DISCOVERY_BACKFILL.md) for a preview, confirmed
run, output monitoring and decision reconciliation. Follow
[controlled live Discovery execution](LIVE_DISCOVERY_EXECUTION.md) for the
only paid-provider path. Apply Qualification profile/catalog changes by
updating validated configuration, rebuilding the affected service, verifying
readiness, and monitoring its first processed messages.

## Safe incident checks

For a broker or MongoDB outage, wait for readiness to recover, then inspect
the durable outbox/inbox/execution records and logs. A failed readiness check is
not a reason to reset databases, delete outputs, purge queues, or re-run a
provider search. Recovery relies on persisted claims, idempotency keys and
bounded retry/DLQ routing.
