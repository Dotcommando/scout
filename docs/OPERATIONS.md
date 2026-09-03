# Local operations runbook

## Start, stop, and health

Start the local stack with `docker compose up -d --build`. Stop it with
`docker compose stop`; this sends Docker's normal termination signal and keeps
MongoDB and RabbitMQ persistent state intact. `docker compose down` removes
containers and networks but retains the named `mongodb_data` and
`rabbitmq_data` volumes. `docker compose down -v` intentionally removes both
volumes and all local service data; use it only when an empty environment is
required.

## Persistent data, inspection, and recovery

MongoDB stores all three service databases in the named `mongodb_data` volume
mounted at `/data/db`; RabbitMQ stores durable queues in `rabbitmq_data` at
`/var/lib/rabbitmq`. Inspect them without changing data:

```powershell
docker volume ls
docker compose exec mongodb mongosh --quiet --eval 'db.adminCommand({ listDatabases: 1 })'
docker compose exec rabbitmq rabbitmqctl list_queues name messages consumers
```

For a local backup, create a dump before infrastructure changes and retain it
outside Docker volumes. Restore only into a deliberately stopped local stack;
never overwrite a running service database or purge RabbitMQ queues to solve a
readiness failure.

```powershell
docker compose exec mongodb mongodump --archive=/tmp/scout-mongodb.archive
docker compose cp mongodb:/tmp/scout-mongodb.archive .\artifacts\scout-mongodb.archive
```

This Compose topology is trusted-development-only. Host ports are for local
debugging and must not be exposed publicly; it has no authentication or
authorization boundary.

Each service exposes two separate checks:

```powershell
Invoke-WebRequest http://localhost:3001/health/live
Invoke-WebRequest http://localhost:3001/health/ready
Invoke-WebRequest http://localhost:3002/health/live
Invoke-WebRequest http://localhost:3002/health/ready
Invoke-WebRequest http://localhost:3003/health/live
Invoke-WebRequest http://localhost:3003/health/ready
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
docker compose logs --tail 200 actor-gateway
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

## Actor Gateway archives

Actor Gateway is the only service that receives `APIFY_API_TOKEN`. Discovery
and Qualification submit versioned exact requests and read resulting archive
endpoints. A successful request status contains `archiveId`; inspect it with:

```powershell
Invoke-WebRequest http://localhost:3003/v1/actor-requests/<requestId>
Invoke-WebRequest http://localhost:3003/v1/actor-requests/archives/<archiveId>
Invoke-WebRequest http://localhost:3003/v1/actor-requests/archives/<archiveId>/content -OutFile archive.gz
```

Archive bytes are gzip-compressed JSON records and checksum-verified by
Gateway before serving. A pending request is never reusable as a success. Do
not run a paid provider capture without the separately approved budget and
sanitized-fixture process.
