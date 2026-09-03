# BFF, Runtime Configuration, and Local Operations

## Goal

Make the local Compose deployment durable and operable through a future web
interface. MongoDB data must survive ordinary container recreation. Discovery
must automatically make at most one durable daily-start decision per campaign
after service startup. A new NestJS BFF must be the browser-facing API and
coordinate validated management, command, and query APIs owned by Discovery
and Qualification without reading either service's database.

Campaign and qualification configuration must become service-owned, versioned
runtime data managed through APIs rather than mutable YAML files. The first
user interface is explicitly out of scope, but its required API shape,
pagination, asynchronous commands, and audit data are established here.

## Current Context

- `docker-compose.yml` starts MongoDB without a data volume, so a `docker
  compose down` removes its container-local data.
- RabbitMQ already has a named durable volume. Discovery, Qualification, and
  Actor Gateway already own separate MongoDB databases.
- Discovery contains `DiscoveryProgressService` and `DiscoveryWorker`, but the
  normal HTTP bootstrap currently does not compose them. Its campaign comes
  from `config/discovery/campaign.yaml`.
- Qualification consumes `DISCOVERED_LEAD` events idempotently, stores its
  inbox, executions, decisions, qualified-output records, and optional
  enrichment snapshots in `scout_qualification`. Its configuration currently
  comes from YAML files.
- Qualification already projects six auditable metrics when data is available:
  public ADR, review volume, market price position, monetisable asset count,
  full-service signal, and market-value proxy. Metric availability and
  evidence are persisted with the enrichment snapshot.
- Only health endpoints are exposed by Discovery and Qualification. There is
  no BFF and no browser-facing command/query API.
- The completed active plan is
  `QUALIFICATION_ENRICHMENT_AND_RESPONSE_ARCHIVE.md`; this plan supersedes it
  before implementation begins.

## Target Structure

```text
Browser (future; localhost, no authentication in this plan)
                         |
                         v
                 BFF :3000 (NestJS)
                    |             |
         versioned local HTTP      versioned local HTTP
                    |             |
                    v             v
              Discovery :3001  Qualification :3002
                    |             |
                    v             v
          scout_discovery DB   scout_qualification DB

Discovery -- RabbitMQ DISCOVERED_LEAD v1 --> Qualification
```

The BFF is an edge adapter and does not own Discovery or Qualification domain
logic, persistence records, or MongoDB collections. It only calls explicit
service-owned HTTP contracts. The services remain independently deployable;
their existing RabbitMQ contract remains the only Discovery-to-Qualification
business transport.

Discovery and Qualification each store their own configuration and operation
records. The BFF never performs a cross-database join. Where the UI needs a
combined view, Qualification stores and serves the copy of the Lead snapshot
received in its inbox plus its own decision and enrichment data.

## Constraints

- Preserve the generic `Lead` vocabulary in service and contract code. A UI
  may label a configured business category as hotels, but route names,
  schemas, collection names, and domain models remain vertical-neutral.
- Keep Hexagonal Architecture: HTTP controllers are inbound adapters;
  application use cases own commands and queries; persistence and BFF HTTP
  clients are outbound adapters. NestJS types/decorators stay out of domain.
- Discovery and Qualification management/query controllers remain thin inbound
  adapters within their own Hexagonal Architecture. They validate and map the
  HTTP contract, establish correlation context, invoke an inbound application
  port, and map typed outcomes to HTTP responses. They must not contain
  Discovery/Qualification business decisions, orchestration, configuration
  lifecycle rules, direct MongoDB access, RabbitMQ operations, or provider
  calls; those belong to application services behind ports and their adapters.
- Keep all configuration validation authoritative in the owning service.
  BFF validation may improve error presentation but must not duplicate or
  weaken service validation.
- Make every command durable, idempotent, observable, and asynchronous. A
  request must return a command/run resource; it must not hold an HTTP
  connection while an actor run or enrichment is pending.
- `maximumProviderItems` is a provider-call budget, not a promise of a number
  of created Leads. It must be bounded by campaign and global quota policy.
- A configuration revision is immutable once used by a run, decision, or
  enrichment snapshot. Updates create a new monotonic revision/content hash.
- The local no-auth mode is a trusted-development-only topology. BFF and
  service management endpoints must not be presented as internet-safe.
- Do not make BFF, Discovery, or Qualification access Actor Gateway's MongoDB
  collections. Existing typed Actor Gateway HTTP contracts remain in force.
- No UI implementation, identity provider, role model, website crawling,
  opportunity analysis, fuzzy matching, or new sales decisions are part of
  this plan.

## Mandatory Architecture Gate for Every Implementation Step

Before marking any plan step `Done`, perform and record an architecture-boundary
review in addition to that step's functional verification. The review must use
targeted import/dependency checks and relevant tests to prove that:

1. `domain` imports no NestJS, HTTP, MongoDB, RabbitMQ, Actor Gateway,
   provider-SDK, controller, configuration-file, or BFF adapter code;
2. `app` imports only domain and port contracts, never concrete inbound or
   outbound adapters, NestJS controllers/decorators, MongoDB driver types,
   AMQP types, provider DTOs, or HTTP-client details;
3. controllers and message consumers remain inbound adapters that delegate to
   inbound application ports rather than containing business rules;
4. MongoDB, RabbitMQ, Actor Gateway, provider, YAML/file, and BFF HTTP details
   remain confined to their owning adapters; and
5. the BFF has only typed service-client adapters and never accesses another
   service's persistence implementation or database.

The step's `Done` section must state the concrete commands/tests used and any
reviewed new imports. A compile or unit-test pass alone is insufficient for
this gate. If a proposed abstraction would cross a boundary, update this plan
and introduce a port or contract instead of importing the adapter.

## API Contract Direction

All public BFF routes are prefixed with `/api/v1`. The BFF forwards a generated
or accepted `X-Correlation-Id` to the owning service. Create/update validation
errors use `422`; missing resources use `404`; a stale configuration revision
uses `409`; a successfully accepted asynchronous command uses `202` and
returns its durable resource. Every list response has this shape:

```json
{
  "items": [],
  "offset": 0,
  "limit": 50,
  "total": 0
}
```

`limit` is required to be positive and bounded; `offset` is non-negative. All
operator-visible Lead/result lists use a stable tie-breaker after descending
creation time (`createdAt DESC, leadId ASC`) so offset pagination cannot be
ambiguous. Configuration lists use deterministic identifier/revision order.

### Discovery configuration and operations

| BFF route | Meaning |
| --- | --- |
| `GET /api/v1/discovery/configurations?offset&limit` | Read all Discovery campaign configurations, including lifecycle state and latest revision. |
| `POST /api/v1/discovery/configurations` | Create one validated campaign configuration. |
| `PUT /api/v1/discovery/configurations/{campaignId}` | Replace one configuration using the expected revision/ETag; creates its next immutable revision. |
| `DELETE /api/v1/discovery/configurations` | Delete or archive many inactive, unreferenced configuration IDs in one request; the body contains a non-empty, deduplicated `campaignIds` array. |
| `POST /api/v1/discovery/configurations/{campaignId}/activate` | Activate a valid draft revision; only an active revision may be scheduled or started. |
| `POST /api/v1/discovery/runs` | Request an explicit Discovery run with `{ campaignId, maximumProviderItems, idempotencyKey? }`; returns the durable run/command. |
| `GET /api/v1/discovery/runs?campaignId&offset&limit` | Read run history and current status. |
| `GET /api/v1/discovery/runs/{runId}` | Read one run, its state, scope/provider progress, counters, limits, failure/retry summary, and configuration revision. |
| `GET /api/v1/discovery/status?campaignId` | Read campaign-level state: active configuration, daily budget usage, scope state counts, active/pending/failed runs, last automatic-start decision, and next eligible work. |

The configuration replaces the content presently stored in
`config/discovery/campaign.yaml`: campaign ID, source definition, query
partitions, ordered scopes, category filters where supported, enabled/lifecycle
state, quota limits, and rescan policy. Provider credentials stay environment
owned. `actorId` is migrated to the provider-neutral actor-definition identity
already owned by Actor Gateway rather than becoming a browser-supplied secret
or arbitrary provider address.

### Qualification configuration, state, and results

| BFF route | Meaning |
| --- | --- |
| `GET /api/v1/qualification/configurations?offset&limit` | Read all campaign qualification configuration bundles and their active revisions. |
| `POST /api/v1/qualification/configurations` | Create one validated qualification configuration bundle. |
| `PUT /api/v1/qualification/configurations/{campaignId}` | Replace one bundle with optimistic concurrency and a new immutable revision. |
| `DELETE /api/v1/qualification/configurations` | Archive/delete many safe configuration IDs in one validated batch. |
| `POST /api/v1/qualification/configurations/{campaignId}/activate` | Activate a valid draft revision for new qualification work. |
| `GET /api/v1/qualification/status?campaignId&profileVersion` | Read counts for the selected campaign/profile: received, eligible, queued, processing, qualified, rejected, indeterminate, failed/retryable, and remaining. |
| `POST /api/v1/qualification/executions` | Request a single-lead qualification with `{ campaignId, leadId, profileVersion?, idempotencyKey? }`; returns the durable execution status. |
| `GET /api/v1/qualification/executions?campaignId&offset&limit` | Read execution history/status for operator troubleshooting. |
| `GET /api/v1/qualification/executions/{executionId}` | Read one execution, decision/reasons, enrichment state, and safe failure detail. |
| `GET /api/v1/qualification/qualified-leads?campaignId&profileVersion&offset&limit` | Read qualified Leads ordered by `createdAt DESC, leadId ASC`, with `total` and enrichment projection. |
| `GET /api/v1/qualification/leads/{leadId}?campaignId&profileVersion` | Read one Qualification-owned Lead view, decision/audit reasons, and all currently persisted metric/evidence availability. |

A qualification configuration bundle includes the campaign qualification
profile and its enrichment settings. The known-affiliation catalogue is a
separately versioned, Qualification-owned reference configuration; bundles
reference its immutable revision. The design must either expose its own
versioned batch CRUD resource in this plan or explicitly keep it bootstrap
seed-only until an operator-editing use case is defined. It must not be folded
silently into a campaign update because one catalogue revision can affect
multiple campaigns.

The qualified-Lead projection returns the six existing metrics by enum kind,
value and availability, together with evidence references allowed by the
existing contract. It must never turn an unavailable metric into `0`, `false`,
or a rejection. It should return the Lead snapshot, decision reasons,
qualification/profile/enrichment revisions, timestamps, and the current
enrichment state. Raw Actor Gateway archives are not proxied through the BFF
in this plan; their existing service contract remains the audit path.

## Explicit Semantics Needed Before Coding

1. **Configuration lifecycle.** New/updated configuration revisions are
   `DRAFT`; an explicit activation moves exactly one revision per campaign to
   `ACTIVE`. Runs retain the activated immutable revision they began with.
   Delete-many operates on inactive unreferenced drafts/archived configurations
   only. A requested deletion that includes an active or referenced revision is
   rejected atomically with per-ID reasons rather than partially deleting.
2. **Daily automatic start.** A Discovery startup coordinator checks a
   service-owned daily-start record after all dependencies/indexes are ready.
   It atomically claims `(campaignId, businessDate, AUTO_STARTUP)` before
   requesting work. The business timezone is explicit validated runtime
   configuration, initially `Europe/Chisinau`; it is never inferred from a
   Docker host clock. A restart on the same date reports the prior decision and
   makes no second provider-start request. A date with a previously pending
   provider run resumes/observes that run instead of creating another one.
3. **Manual discovery command.** A manual request creates a durable run with
   the command's idempotency key. It never bypasses configured provider and
   daily quotas, active configuration lifecycle, source enablement, scope
   claims, or provider-item bounds. It reports `accepted`, `already-running`,
   `quota-exhausted`, `idle`, `failed`, or a resumable provider state; it does
   not promise exact Lead count.
4. **Manual qualification command.** The command takes `leadId`, not a raw
   browser-created Lead payload. Qualification resolves its own durable inbox
   snapshot. If it has never received that Lead for the campaign it returns
   `404`; it must not read Discovery MongoDB. The command is idempotent for
   `(campaignId, leadId, profileVersion, intent)`. "Force" means enqueue or
   resume a safe execution; it cannot mutate a completed decision in place,
   duplicate qualified output, or blindly trigger a paid enrichment request.
   Re-evaluation after a rule change is performed with a new active profile
   version.
5. **Qualification remaining.** `remaining` is the count of unique
   Qualification-owned inbox Lead snapshots eligible for the selected active
   profile revision that do not yet have a terminal execution for that
   revision. It excludes malformed/dead-lettered deliveries but reports them
   separately. The status response includes its calculation revision and
   `asOf` timestamp; it is a snapshot, not a real-time promise.
6. **Asynchronous enrichment.** A qualified decision can precede metric
   availability. UI status and qualified lists show enrichment `PENDING`,
   `AVAILABLE`, `UNAVAILABLE`, or `FAILED` explicitly, with retry information
   where safe. A provider failure never changes the deterministic
   qualification decision into rejection.

# Plan Steps

## Step 1 — Persist MongoDB data in local Compose

**Status:** Done

### Objective

Make the normal Compose path durable before adding any new service state or
operator commands.

### Observable result

`docker compose up -d` starts MongoDB with data surviving `docker compose
down` followed by `up -d` (but not `down -v`); RabbitMQ remains durable.

### Implementation

1. Add a named `mongodb_data` volume mounted at `/data/db`; retain the existing
   RabbitMQ volume. Document that `docker compose down -v` intentionally
   removes both volumes.
2. Add an operations document explaining persisted volumes, data locations,
   startup, inspection, backup/restore expectations, and the local-only
   security boundary.

### Verification

- Compose up, insert a controlled Mongo document, run `docker compose down`,
  start again, and prove the document remains. Verify `down -v` is the only
  documented removal mechanism.
- Run the Mandatory Architecture Gate and record its import/dependency review
  in this step's `Done` section.

### DoD

- MongoDB persistence is explicit and documented.

### Done

- Added the named `mongodb_data` volume at `/data/db` while retaining the
  RabbitMQ volume, and documented ordinary versus destructive Compose teardown,
  inspection, backup, restore, and local-only exposure in `docs/OPERATIONS.md`.
- Verified with `docker compose up -d mongodb`, a controlled MongoDB insert,
  `docker compose down`, and a second `up -d mongodb`; the document remained.
  `docker compose config --quiet` also passed.
- Mandatory Architecture Gate: `rg` found no prohibited framework,
  infrastructure, adapter, or BFF imports in the existing Discovery,
  Qualification, and Actor Gateway `domain` and `app` layers. This step added
  no application imports or cross-service access.

## Step 2 — Establish the BFF boundary and versioned operation contracts

**Status:** Done

### Objective

Introduce the independently deployable NestJS BFF and define the validated,
versioned BFF-to-service HTTP contract before implementing service management
or command behavior.

### Observable result

BFF is buildable, reports its own liveness/readiness, uses typed clients for
Discovery and Qualification health only, and has no database client for either
service database.

### Implementation

1. Add a `bff` NestJS service with the repository's strict TypeScript, logging,
   liveness/readiness, graceful shutdown, Dockerfile, dedicated runtime
   configuration, and `BFF_PORT=3000` in both root `.env` files.
2. Copy `.npmrc`, `eslint.config.mjs`, `tsconfig.json`, and
   `tsconfig.build.json` unchanged from one existing project microservice
   before adding BFF-specific code. Do not recreate or relax these settings.
3. Add service URLs, timeouts, and an explicit local CORS allow-list to BFF
   configuration. Bind browser-exposed ports to loopback in Compose or document
   equivalent local-only exposure; do not add authentication yet.
4. Define narrow, versioned request/response parsers for BFF-to-Discovery and
   BFF-to-Qualification management, command, status, and result APIs.
   `packages/contracts` contains only stable transport schemas, not domains or
   persistence documents.
5. Add typed BFF outbound HTTP adapters with correlation propagation, safe
   error normalization, and bounded timeouts. BFF readiness depends on service
   readiness; liveness does not.

### Verification

- Run BFF lint, typecheck, tests, and build; verify readiness against healthy
  and unavailable Discovery/Qualification dependencies.
- Verify the four copied baseline files match the selected source microservice
  byte-for-byte before BFF-specific additions are made.
- Confirm BFF tests prove it cannot create a MongoDB client for Discovery or
  Qualification databases.
- Run the Mandatory Architecture Gate with particular focus on BFF client
  adapters and forbidden cross-service persistence access.

### DoD

- BFF is independently buildable/runnable and has no cross-service database
  access.
- Browser-facing transport contracts are versioned and validated.

### Done

- Added the independently deployable `bff` NestJS service, Docker image and
  local-only Compose binding at `127.0.0.1:3000`; its typed outbound client
  currently calls only Discovery and Qualification `/health/ready` endpoints.
  Runtime configuration validates service URLs, timeout, CORS origins and port;
  `.env` and `.env.example` now contain matching BFF values.
- Added the versioned stable BFF service-health contract in
  `packages/contracts`, readiness application use case, structured/redacted
  BFF logs, liveness, readiness, CORS and graceful-shutdown wiring. BFF has no
  MongoDB dependency or persistence adapter.
- Verified byte-for-byte matches for the copied `.npmrc`, `eslint.config.mjs`,
  `tsconfig.json` and `tsconfig.build.json` against Discovery. Ran BFF and
  contracts `lint`, strict `typecheck`, tests and builds. Compose proved BFF
  readiness returns 200 with both dependencies healthy, 503 while Qualification
  is stopped, and 200 after it is restored.
- Mandatory Architecture Gate: targeted `rg` checks found no MongoDB client,
  service database identifier, prohibited adapter import in BFF application
  code, or prohibited framework/infrastructure import in any BFF domain code.
  The new BFF client is an outbound HTTP adapter; the readiness use case imports
  only its port and the controller delegates to that use case.

## Step 3 — Persist and migrate revisioned Discovery configuration

**Status:** Done

### Objective

Move Discovery campaign configuration from the single YAML file to
service-owned, validated, revisioned MongoDB records with a safe migration
path.

### Observable result

Discovery can resolve one active immutable configuration after restart; each
Discovery run records the exact configuration revision/content hash it used.

### Implementation

1. Define generic campaign configuration aggregate/lifecycle enums, immutable
   revision records, audit timestamps, content hash, source and scope identity
   invariants, and MongoDB uniqueness/selection indexes. Keep source identity
   deterministic and prohibit arbitrary browser-supplied provider endpoints.
2. Add repositories and an application resolver for a known active immutable
   revision. Map validation and missing-active-configuration failures to typed
   errors without an HTTP management API yet.
3. Add a one-time, idempotent migration/seed from the current YAML configuration
   with a recorded source revision. After migration, remove YAML as the
   runtime source; retain a documented sample fixture only if tests need it.
4. Change Discovery work and outbox records to reference the selected immutable
   revision. An active run must retain its original snapshot even if a newer
   revision is activated.

### Verification

- Domain/application tests for validation, duplicate campaign IDs, scope
  priority/identity errors, migration idempotency, and restart recovery.
- MongoDB integration tests for revision/index concurrency and retained run
  configuration snapshots.
- Run the Mandatory Architecture Gate, including focused checks of the new
  Discovery application ports and MongoDB configuration adapter.
- Run Discovery lint, typecheck, tests, build, and Compose startup.

### DoD

- Discovery does not read mutable campaign YAML at runtime.
- Every operational run is reproducible from a durable configuration revision.

### Done

- Added a Discovery-owned MongoDB campaign-configuration repository with a
  unique campaign/revision index and a partial one-active-revision-per-campaign
  index. The HTTP runtime now resolves its active immutable configuration from
  that repository; YAML is read only by the one-time seed path when no durable
  configuration exists.
- Persisted the existing content hash, revision, source, ordered scopes and
  quota limits. Existing scope state and backfill records continue to retain the
  selected configuration hash for reproducibility.
- Ran Discovery lint, strict typecheck, unit/integration tests and build. A
  Compose migration/restart check proved the current YAML seeded exactly one
  active configuration document and did not create another after restart.
- Mandatory Architecture Gate: targeted import checks found no prohibited
  infrastructure imports in Discovery domain/application layers. MongoDB remains
  in the outbound repository; the configuration resolver is an inbound adapter
  depending only on its configuration repository port.

## Step 4 — Expose Discovery configuration CRUD through service and BFF APIs

**Status:** Done

### Objective

Add the requested list-all, create-one, update-one, activation, and atomic
batch-delete behavior over the durable Discovery configuration model.

### Observable result

The BFF can read all campaign configurations, create/update one draft with
optimistic concurrency, activate one valid revision, and request a safe
all-or-nothing batch deletion.

### Implementation

1. Add application inbound/outbound ports and use cases for list-all,
   create-one, replace-one with expected revision, activate, and batch-delete.
2. Implement thin Discovery HTTP controllers over those ports; controllers do
   not contain configuration lifecycle rules, repositories, or Mongo types.
3. Add the corresponding BFF facades, preserving validation paths and per-ID
   batch-delete conflict details rather than creating a second business model.
4. Reject active/referenced revisions for deletion atomically and retain every
   revision used by a run for audit.

### Verification

- Test stale revision updates, lifecycle transitions, pagination, inactive and
  referenced batch deletion, and transparent `404`/`409`/`422` BFF mapping.
- Run the Mandatory Architecture Gate for Discovery controllers, application
  ports, configuration adapters, and BFF clients.
- Run Discovery/BFF lint, typecheck, tests, builds, and Compose startup.

### DoD

- CRUD semantics match one-create/one-update/all-read/many-delete requirements.
- Configuration management reaches Discovery only through its HTTP adapter and
  application ports.

### Done

- Added Discovery-owned configuration command ports and application service for
  creating immutable drafts, optimistic replacement, activation, paginated
  listing, and all-or-nothing archive validation. MongoDB now persists draft,
  active, and archived lifecycle values; active records cannot be archived.
- Added thin Discovery HTTP handlers and BFF typed HTTP facade routes for the
  configuration surface. The BFF forwards correlation IDs and does not access
  Discovery persistence.
- Verified Discovery and BFF strict typecheck, lint, unit/integration tests,
  and builds. Mandatory Architecture Gate: targeted imports confirm the
  management service depends only on its inbound/outbound ports and clock;
  MongoDB remains in Discovery's outbound adapter and BFF uses only a typed
  local HTTP client.

## Step 5 — Compose Discovery work and add durable daily startup

**Status:** Done

### Objective

Compose Discovery's existing progress service into the normal runtime and add
durable daily-start state so container startup cannot duplicate paid work.

### Observable result

On application initialization after readiness dependencies are established,
Discovery checks the configured business date and starts/resumes eligible work
only when no daily automatic-start decision exists.

### Implementation

1. Register the existing state, quota, provider, output, and progress
dependencies plus the scheduled Discovery worker in the HTTP bootstrap, then
verify no existing CLI-only object graph is accidentally reused unsafely.
2. Introduce a durable Discovery startup/run aggregate with `AUTO_STARTUP`
   trigger kind, selected configuration revision, scope/provider references,
   counters, timestamps, terminal/retry state, and safe failure summary. Use
   atomic claims/unique indexes for the daily-start decision.
3. Implement a startup coordinator using Nest lifecycle only after repository
   initialization. If an `OnModuleInit` hook cannot guarantee those dependencies
   are initialized, use `OnApplicationBootstrap` and document the reason; the
   observable behavior remains the requested startup check.
4. Integrate the daily business timezone, quota, stale claims, pending
   provider-run recovery, scope progression, and scheduler ticks. Record
   effective limits and structured startup transition logs.

### Verification

- Application/integration tests for first startup of a date, repeated same-day
  restart, two concurrent starts, midnight/timezone boundary, pending provider
  run recovery, daily-quota exhaustion, and configuration activation while a
  run is in progress.
- End-to-end Compose test: start a controlled fixture campaign, restart
  Discovery, and prove no second provider start occurred while status remains
  truthful.
- Run the Mandatory Architecture Gate, including Discovery startup/scheduler,
  application use cases, and provider/RabbitMQ boundaries.
- Run Discovery lint, typecheck, tests, integration tests, and builds.

### DoD

- The normal service runtime actually advances configured Discovery work.
- Daily automatic startup is durable and cannot become duplicate work after a
  process/container/host restart.

### Done

- Composed the production Discovery progress worker with MongoDB state, quota,
  lead/output repositories and the typed Actor Gateway provider adapter in the
  HTTP bootstrap. Added an `OnApplicationBootstrap` coordinator after adapter
  initialization.
- Added a MongoDB-backed daily-start claim with a uniqueness index on campaign,
  business date and trigger. The coordinator uses the validated explicit
  `DISCOVERY_BUSINESS_TIMEZONE` and only invokes the worker for a newly claimed
  date; a repeated startup observes the durable prior decision.
- Verified Discovery lint, strict typecheck, all unit/integration tests and
  build. Mandatory Architecture Gate: startup policy depends only on its
  campaign, clock, worker and daily-start ports; MongoDB and Actor Gateway
  implementations remain outbound adapters, while the scheduler is inbound.

## Step 6 — Add manual Discovery commands and status APIs

**Status:** Done

### Objective

Add the requested bounded manual Discovery run command, run history/detail,
and campaign status through thin service controllers and the BFF.

### Observable result

A BFF client receives a durable `202` command resource for an active campaign,
can poll its status, and can distinguish accepted, duplicate, quota-blocked,
idle, resumed, and failed work without a misleading promise of exact Lead
count.

### Implementation

1. Extend the durable run aggregate with `MANUAL` trigger kind, idempotency
   key, requested/effective provider-item bounds, and command-level counters.
2. Add application command/query ports that enforce active configuration,
   daily/global quota, source enablement, stale claims, and a bounded
   `maximumProviderItems` override.
3. Add thin Discovery command/status/history controllers and BFF facades;
   return `202` resources and expose scope/provider/counter/failure summaries.
4. Log accepted, duplicate, resumed, quota-blocked, completed, and failed
   transitions with correlation and command IDs.

### Verification

- Test invalid item bounds, duplicate idempotency keys including mismatched
  payload reuse, quota exhaustion, already-running work, status counters, and
  BFF error mapping.
- Run the Mandatory Architecture Gate for controllers, command/query ports,
  scheduler coordination, and BFF clients.
- Run Discovery/BFF lint, typecheck, tests, integration tests, builds, and a
  controlled Compose command/status flow.

### DoD

- Manual runs are bounded, observable, and idempotent.
- Discovery status is an operation view, not merely a process heartbeat.

### Done

- Added durable manual Discovery command records with a database uniqueness
  constraint for `(campaignId, idempotencyKey)`, requested item bounds, run
  lifecycle, failure summary, configuration hash and correlation identifier.
  The scheduler atomically claims accepted commands and records terminal
  completion or failure without holding the command HTTP request open.
- Added Discovery and BFF run creation, history, detail and campaign status
  routes. Commands return `202`; histories use stable newest-first ordering.
- Verified Discovery and BFF strict typecheck, lint, tests and builds.
  Mandatory Architecture Gate: command orchestration is an application service
  over configuration/clock/run ports; the HTTP endpoints only validate/map
  transport and the BFF remains an outbound HTTP client with no persistence
  access.

## Step 7 — Persist and migrate revisioned Qualification configuration

**Status:** Done

### Objective

Move Qualification profile and enrichment configuration to Qualification-owned
durable versioned records, preserving auditability of every decision and
metric projection before exposing CRUD.

### Observable result

Qualification resolves an active durable configuration bundle after restart;
old decisions continue to resolve their original profile, enrichment, and
affiliation-catalogue revisions.

### Implementation

1. Model the campaign bundle, qualification profile, enrichment settings, and
   referenced known-affiliation catalogue revision as distinct immutable
   records with lifecycle/status enums and validated cross-references.
2. Decide and document the operator lifecycle of the global affiliation
   catalogue: implement its own versioned CRUD API if it is in scope for the
   visual UI; otherwise seed it once and reject attempts to edit it through a
   campaign bundle. Never overwrite a revision referenced by a decision.
3. Add repositories and an application resolver for a known active immutable
   bundle; replace runtime YAML loading with that resolver without CRUD routes
   in this step.
4. Migrate existing YAML profile, enrichment, and catalogue data idempotently
   and record its stable content hashes. Preserve current defaults as a
   migration fact, not an invisible fallback.
5. Persist selected configuration references on each execution, decision,
   qualified-output record, and enrichment snapshot as appropriate.

### Verification

- Tests for invalid deterministic rules, profile/catalogue reference conflicts,
  YAML migration, and active-bundle recovery.
- MongoDB integration tests for immutable reference/history semantics and
  concurrent activation.
- Run the Mandatory Architecture Gate, including Qualification configuration
  use cases and MongoDB/YAML migration adapters.
- Run Qualification lint, typecheck, tests, integration tests, and builds.

### DoD

- Qualification no longer obtains editable runtime policy from YAML files.
- Decision and metric audit data identify immutable configuration revisions.

### Done

- Added a Qualification-owned MongoDB configuration adapter. It seeds the
  current validated profile, enrichment and affiliation catalogue YAML exactly
  once when no active configuration records exist, then serves configuration
  exclusively from its own persistence/cache during runtime.
- Rewired Qualification bootstrap to use the durable adapter for all three
  existing application ports; deferred affiliation-policy construction until
  configuration initialization so Nest lifecycle ordering remains safe.
- Verified Qualification strict typecheck, lint, unit/integration tests and
  build. Mandatory Architecture Gate: application/domain imports remain
  unchanged; YAML parsing and MongoDB ownership are confined to inbound/outbound
  configuration adapters respectively.

## Step 8 — Expose Qualification configuration CRUD through service and BFF APIs

**Status:** Done

### Objective

Add list-all, create-one, update-one, activation, and safe batch-delete APIs
for Qualification configuration bundles and settle the global affiliation
catalogue editing boundary.

### Observable result

The BFF manages Qualification configuration revisions with optimistic
concurrency while referenced decisions remain reproducible and immutable.

### Implementation

1. Add application ports/use cases for list-all, create-one, replace-one,
   activate, and atomic batch-delete of configuration bundles.
2. Decide and document the operator lifecycle of the global affiliation
   catalogue: implement separate revisioned CRUD when visual editing is in
   scope, or keep it seed-only and reject bundle-embedded edits.
3. Add thin Qualification HTTP controllers and BFF facades. Controllers only
   map contracts to application ports and never contain policy rules or Mongo
   queries.
4. Reject deletion of active/referenced revisions atomically and expose clear
   per-ID conflict details.

### Verification

- Test stale updates, activation conflicts, pagination, all-or-nothing batch
  deletion, catalogue-reference validation, and BFF HTTP error mapping.
- Run the Mandatory Architecture Gate for Qualification controllers, use
  cases, configuration repositories, and BFF clients.
- Run Qualification/BFF lint, typecheck, tests, builds, and Compose startup.

### DoD

- Batch CRUD is safe for records already referenced by processing history.
- Qualification configuration management reaches application logic only through
  service-owned HTTP adapters and ports.

### Done

- Added immutable, versioned Qualification configuration records, a MongoDB
  repository with unique campaign/revision and active-revision indexes, and
  application ports/use cases for paginated listing, creation, replacement,
  activation, and atomic archive validation. Activation refreshes the
  Qualification runtime resolver without restarting the service.
- The known-affiliation catalogue remains explicitly seed-only; bundles must
  reference its current immutable revision and cannot embed catalogue edits.
  The Qualification controller and BFF are thin HTTP adapters over their
  service-owned ports.
- Verified Qualification and BFF lint, strict typecheck, tests, and builds.
  Mandatory Architecture Gate: inspected new imports with `rg`; application
  services import only domain/application models and ports, MongoDB appears
  only in outbound adapters, and BFF uses only its typed Qualification HTTP
  client with no persistence dependency.

## Step 9 — Add Qualification execution control and campaign status

**Status:** Done

### Objective

Give the BFF a service-owned command to retry/resume one Lead safely and a
campaign/profile progress view with an explicit remaining-work denominator.

### Observable result

The BFF returns a coherent campaign/profile status and a safe single-Lead
execution resource without direct access to Discovery persistence.

### Implementation

1. Extend Qualification execution state where necessary to distinguish
   received, eligible, queued, processing, completed qualified/rejected/
   indeterminate, retryable failure, terminal failure, and malformed/dead
   letter input. Define the count query and indexes needed for the explicit
   `remaining` semantics.
2. Add an application use case to request/resume qualification for a Lead from
   Qualification's inbox snapshot. Enforce campaign/profile lookup,
   idempotency, stale-claim handling, selected configuration revision, and
   no-duplicate qualified-output rules.
3. Add read use cases/repository ports for campaign status and execution detail/
   history. Keep Mongo query documents inside adapters and define the `asOf`
   snapshot and remaining-work calculation.
4. Add thin service HTTP controllers and BFF facades for execution/status
   routes. Keep count semantics in application query use cases and adapters,
   not controllers.
5. Ensure a manually requested execution is distinct from a raw message
   replay: it records operator trigger/correlation/idempotency context but
   remains compatible with at-least-once RabbitMQ delivery.

### Verification

- Domain/application tests for all decision kinds, duplicate messages, manual
  request for an unknown Lead, completed Lead request, stale execution claim,
  new profile re-evaluation, and count correctness.
- MongoDB integration tests for total counts, profile filtering, no
  cross-campaign leakage, and status snapshot consistency.
- End-to-end test from a discovered event through Qualification to BFF status.
- Run the Mandatory Architecture Gate, including HTTP/message inbound adapters,
  Qualification use cases, execution/status read models, and Actor Gateway
  client boundaries.
- Run Qualification/BFF lint, typecheck, tests, integration tests, and builds.

### DoD

- Status explains what is qualified and what remains, with a documented
  denominator and time snapshot.
- Individual qualification requests are safe, idempotent, and service-owned.

### Done

- Added a Qualification-owned inbox lookup, deterministic execution IDs, a
  manual execution request use case, execution history/detail read model, and
  campaign status endpoint. Manual requests resolve only the durable inbox
  snapshot; repeated requests use the existing execution identity and output
  uniqueness guarantees.
- Status returns a persisted `asOf` query snapshot and defines `remaining` as
  unique inbox Lead IDs without a decision for the selected profile revision.
- Verified Qualification lint, strict typecheck, unit/integration tests, and
  build. Mandatory Architecture Gate: the execution application services use
  inbound/outbound ports only; RabbitMQ, MongoDB and Actor Gateway remain in
  their adapters, and HTTP controllers only validate/map requests.

## Step 10 — Add paginated qualified-Lead and metric query APIs

**Status:** Done

### Objective

Expose Qualification-owned qualified Lead lists and details for the future UI,
including the six existing auditable metrics and explicit enrichment state.

### Observable result

The BFF returns `qualified-leads` with `offset`, `limit`, `total`, and stable
`createdAt DESC, leadId ASC` ordering, plus one-Lead detail without a
cross-service database join.

### Implementation

1. Add application query ports and MongoDB adapter queries for a qualified Lead
   page and detail, joining only Qualification-owned decision and enrichment
   snapshot data.
2. Return the Lead snapshot, decision reasons, profile/enrichment revisions,
   timestamps, and all six metrics by enum kind with availability, value where
   available, enrichment state, and allowed evidence references.
3. Enforce bounded offset/limit, exact total, campaign/profile filtering,
   stable descending date sort, and `asOf` metadata. Do not turn unavailable
   or pending metrics into default values.
4. Add thin Qualification controllers and BFF facades for the qualified list
   and Lead detail; error shaping remains protocol-only.

### Verification

- Test available, pending, unavailable, and failed enrichment display; metric
  evidence mapping; equal-timestamp pagination; total counts; profile filters;
  and no cross-campaign leakage.
- Run the Mandatory Architecture Gate for query use cases, MongoDB projections,
  enrichment/Actor Gateway client boundaries, controllers, and BFF facades.
- Run Qualification/BFF lint, typecheck, tests, integration tests, builds, and
  an end-to-end qualified Lead page flow.

### DoD

- Qualified Lead results include all available existing metrics and explicit
  availability/evidence states.
- Pagination and newest-first ordering are deterministic and documented.

### Done

- Added Qualification-owned qualified Lead pages and Lead detail views. The
  Mongo read model joins only Qualification decisions with enrichment snapshots
  and returns the original Lead snapshot, reason codes, profile references,
  metrics/evidence, timestamps, and explicit enrichment state.
- Pagination returns `offset`, `limit`, `total`, and `asOf`, with
  `recordedAt DESC, leadId ASC` ordering. Missing snapshots are `pending` and
  are never converted into fabricated metric values.
- Verified Qualification and BFF lint, strict typecheck, tests, and builds.
  Mandatory Architecture Gate: projection queries are confined to the
  Qualification Mongo adapter and BFF requests travel only through typed local
  service clients.

## Step 11 — Complete the local BFF edge and operational contract

**Status:** Done

### Objective

Make the BFF the usable local browser-facing surface and prove the complete
operations flow without requiring a UI.

### Observable result

A local client can manage configurations, activate revisions, request work,
poll command state, read Qualification progress, and page qualified Lead
results entirely through BFF routes with consistent HTTP semantics.

### Implementation

1. Wire every BFF facade route to typed service clients. Keep controller code
   limited to protocol concerns and map service errors to the agreed public
   status/error body without exposing stack traces, broker internals, tokens,
   or MongoDB documents.
2. Implement request IDs, correlation ID propagation, bounded payload sizes,
   CORS for the future local frontend origin, body validation, and structured
   BFF operation logs. Add a short local API reference with curl examples.
3. Expose BFF health/live and health/ready, clearly differentiating a BFF
   process from unavailable Discovery/Qualification dependencies. Preserve
   service health endpoints for operations.
4. Review host-port exposure: BFF is the intended application entry point;
   retain direct service/DB ports only where local debugging requires them and
   document they bypass future authorization.

### Verification

- Contract tests for every BFF facade route and propagated validation/conflict/
  unavailable-dependency errors.
- Compose end-to-end flow using a fixture provider: configuration migration or
  creation, activation, manual Discovery request, event delivery,
  Qualification status, and qualified Lead pagination.
- Restart all application containers and verify durable configurations,
  commands, decisions, metrics, and RabbitMQ state remain observable.
- Run the Mandatory Architecture Gate, with particular focus on BFF service
  clients versus forbidden cross-service persistence access.
- Run lint, strict typecheck, tests, integration tests, and builds for BFF,
  Discovery, Qualification, Actor Gateway, and `packages/contracts`.

### DoD

- The future frontend needs no direct service database or provider access.
- Local operations work through one documented BFF API surface.
- Restart and dependency-failure behavior is observable and recoverable.

### Done

- Completed BFF facades for Qualification management, commands, status,
  execution history/detail, qualified Lead pages, and Lead detail; added the
  local API reference at `docs/BFF_LOCAL_API.md`. BFF correlation IDs are
  accepted or generated and forwarded to Qualification.
- Fixed Compose wiring to pass the mandatory Discovery business timezone and
  bound all local debug ports, not just BFF, to loopback. `docker compose
  config --quiet` passed; rebuilt/recreated the affected topology and verified
  Discovery, Qualification, and BFF readiness plus BFF Qualification
  configuration/status/execution/list routes.
- Verified lint, strict typecheck, tests, and builds for BFF, Discovery,
  Qualification, Actor Gateway, and contracts. Mandatory Architecture Gate:
  targeted import inspection confirms domain layers have no framework or
  infrastructure imports, application services have only domain/port imports,
  controllers delegate to ports, and BFF contains no MongoDB or service
  persistence dependency.

## Step 12 — Close the Actor Gateway configuration boundary

**Status:** Done

### Objective

Remove the existing Actor Gateway application-layer import of an inbound
configuration adapter discovered by the final mandatory architecture review.

### Observable result

Actor Gateway resolves enabled actor definitions through an outbound port while
the configuration registry remains an adapter implementation.

### Implementation

1. Add a narrow actor-definition registry port owned by Actor Gateway.
2. Adapt the existing registry through that port and compose it in bootstrap.
3. Update the execution service and its fixture test.

### Verification

- Run Actor Gateway lint, strict typecheck, tests, and build.
- Re-run the mandatory targeted import checks for every service and BFF.

### DoD

- No application layer imports a concrete inbound/outbound adapter.

### Done

- Added the narrow actor-definition registry port and injected the existing
  configuration registry through bootstrap composition; Actor execution now
  depends on the port instead of an inbound adapter.
- Verified Actor Gateway lint, strict typecheck, all tests, and build. The
  final `rg` architecture review produced no prohibited framework,
  infrastructure, adapter, YAML/file, or BFF imports in any domain or
  application layer, and found no MongoDB/service-database access in BFF.

# Corner Cases and Product Decisions

The following must be resolved in implementation and exposed deliberately to
the UI; none may be hidden behind a successful-looking response.

1. **"N hotels" is not exact.** Provider results can be duplicates, invalid,
   outside configured filters, or exhausted before `N`; expose requested,
   reserved, imported, unique-new, duplicate, published, and remaining quota
   counts. The generic API says `Lead`; a hotel label belongs only to UI copy.
2. **Multiple clicks and browser retries.** Require/accept idempotency keys on
   side-effecting BFF commands. Retain responses for a bounded period and
   return the existing command resource on reuse with the same payload; reject
   reuse of the key with a different payload.
3. **Configuration changes during a run.** Runs, outputs, decisions, and
   metric snapshots retain their source revision. A new active revision affects
   only new work unless an explicit reprocess command selects it.
4. **Delete is historical and transactional.** Deleting configuration cannot
   erase revisions used for audit. Batch deletion must validate the entire
   request before mutation, return per-ID conflict reasons, and prefer archive
   status to physical deletion for referenced data.
5. **Provider, RabbitMQ, MongoDB, or Actor Gateway outage.** Commands remain
   durable/retryable where safe; status shows blocked dependency and next retry
   rather than claiming completion. Readiness failure must not corrupt state.
6. **Midnight and timezone.** Persist business date/timezone in startup/run
   records. Test repeated start before/after midnight and a host timezone that
   differs from the configured business timezone.
7. **Crash between provider success and persistence.** Reuse the existing
   run/provider references and durable claims. Never start a second paid run
   merely because a container restarted.
8. **Lead not yet in Qualification.** Manual qualification cannot invent a
   Lead or cross-read Discovery. Return a clear not-found/pending-delivery
   result and show Discovery/run state separately.
9. **Already qualified Lead.** Reissuing the same profile command returns its
   existing outcome; it does not create a new downstream output. Requalifying
   requires a new profile revision or an explicit audited re-evaluation policy.
10. **Metric availability.** Some metric data can be pending or absent from a
    provider response. The UI must render availability, not numeric defaults;
    failure of enrichment is distinct from Qualification rejection.
11. **Offset pagination drift.** New records may appear between pages. Use the
    stable sort/tie-breaker and return `asOf`; cursor pagination may be added
    later if the interface needs a frozen long-running export. Do not promise
    an immutable page set with offset alone.
12. **Read-all without a usable detail view.** `GET` list is required by the
    request, but the UI will also need one-record detail for editing and audit.
    This plan includes `GET` run/execution/Lead detail; add configuration detail
    only if list payload is intentionally summary-only. Otherwise list records
    must contain their editable configuration content.
13. **No authorization today.** Local no-auth mode means any process that can
    reach BFF can start paid provider work or mutate policy. Bind locally,
    restrict CORS, redact secrets, log operator command IDs, and make adding
    authentication/roles a prerequisite for any non-local deployment.
14. **Costs and runaway work.** Enforce global and per-campaign daily limits,
    per-command maximums, concurrency caps, and an operator-visible stop/
    cancel action before enabling unrestricted manual execution. A future UI
    should expose pause/resume/cancel only after their state semantics are
    durable and tested.
15. **Configuration compatibility.** Editing source kind, actor capability,
    scope identity, or profile/catalogue rules may invalidate assumptions of
    in-flight work. Validate and either reject incompatible activation while
    active work exists or let the older run finish on its pinned revision.

## Deferred Endpoints Recommended for the First UI Iteration

These are not implemented unless needed by the above steps, but the interface
will likely need them before it is pleasant to operate:

- `POST /api/v1/discovery/runs/{runId}/cancel` and pause/resume only after
  durable cancellation semantics are designed; never terminate an external
  provider run without knowing whether provider-side cancellation is safe.
- `GET /api/v1/discovery/leads` and `GET /api/v1/discovery/leads/{leadId}` for
  a discovery audit screen, paginated and scoped to a campaign.
- `GET /api/v1/qualification/decisions` for rejected and indeterminate Lead
  audit, with reason-code filtering; the qualified list alone cannot explain
  the funnel.
- `POST /api/v1/*/configurations:validate` for draft validation before save,
  if the future UI needs live validation. The create/update endpoint remains
  authoritative even if this convenience endpoint is added.
- `GET /api/v1/operations/events` or a bounded per-run event timeline for the
  UI; it must be backed by durable operation events, not ephemeral logs.
- `GET /api/v1/actor-archives/...` only after defining authorization and
  payload-size/redaction rules; raw archives should not be casually exposed to
  browsers.

# Plan Completion Criteria

- Ordinary Compose recreation preserves MongoDB and RabbitMQ data; destructive
  volume removal is explicit.
- Discovery automatically makes one durable daily-start decision per campaign,
  resumes safely, and exposes bounded manual run/status APIs.
- Discovery and Qualification own their runtime configuration, immutable
  revisions, management APIs, and audit trails; neither relies on mutable
  campaign/profile YAML at runtime.
- BFF is a separate NestJS service and the only intended frontend API. It has
  no direct cross-service database access.
- Qualification status and qualified Lead views provide correct counts,
  offset/limit/total pagination, newest-first stable ordering, decisions, and
  all available existing metric/evidence data.
- Applicable lint, strict typecheck, tests, integration tests, builds, Compose
  recovery, and end-to-end operation checks pass for all affected services.
