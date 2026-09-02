# RabbitMQ Delivery and Configuration-Driven Qualification

## Goal

Deliver Discovery lead outputs reliably to Qualification through RabbitMQ, then
make Qualification an independently deployable, restart-safe, idempotent, and
configuration-driven service. The first active campaign must filter leads that
have a deterministic affiliation with a known hospitality brand while keeping
the platform core vertical-neutral.

## Current Context

- Discovery persists a provider-neutral, version-1 payload in its MongoDB
  `discovery_outputs` outbox. A unique `(campaignId, leadId)` and deterministic
  `outputId` already prevent a new lead from creating multiple outputs.
- The current payload contains campaign, event, correlation, and timestamp
  fields plus a lead snapshot with source identity, name, optional address,
  phone number, and website URL. It does not contain structured country,
  provider category, operating status, review data, room count, or OTA data.
- `DISCOVERY_OUTPUT_STATUS` currently has only `PENDING` and `PUBLISHED`.
- Qualification currently has only HTTP health/bootstrap and its own MongoDB
  connection. It has no domain model, campaign-profile configuration, message
  consumer, or persistence model for decisions.
- Legacy ID-only outputs were deliberately removed by the operator. Remaining
  stored Discovery leads have no durable campaign-membership record, so a
  historical replay cannot infer a campaign safely.

## Direction

```text
Discovery lead + outbox
        |
        | publisher confirms; at-least-once
        v
RabbitMQ discovery.lead.v1 topic exchange
        |
        v
Qualification durable queue -> validate -> idempotent decision record
                                      |
                                      v
                         Qualification delivery-ready output for a later service
```

RabbitMQ is a transport adapter, not the source of truth. Discovery retains
the outbox until the broker confirms publication. Qualification owns only its
own inbox/execution/decision/output records and never reads Discovery MongoDB.

## Constraints

- Keep both services independently buildable, runnable, stoppable, and
  deployable; neither may import the other's application or domain code.
- Define the cross-service payload once as an explicit, versioned transport
  contract. `packages/contracts` may contain only that contract and its
  validation helpers, not shared domain or application code.
- Treat RabbitMQ delivery as at-least-once. A broker-confirmed message may be
  published again after a process crash; qualification must acknowledge it as
  a safe duplicate.
- Validate all environment and YAML configuration at startup. RabbitMQ URL and
  operational tuning are runtime configuration; targeting and affiliation data
  are campaign/profile configuration.
- Use enums for every closed set of values and strict TypeScript without the
  forbidden escape hatches in `AGENTS.md`.
- Keep all ordinary tests offline: no live discovery provider calls and no
  external brand-lookup calls. RabbitMQ integration tests may use the local
  Docker service only.
- The plan may make controlled live Discovery calls only through a dedicated
  opt-in execution. The normal expected daily collection is at most 100
  provider items; 600 provider items is a hard maximum for the whole plan, not
  a collection target.
- Do not add website crawling, OTA inspection, review analysis, contact search,
  pitch generation, probabilistic entity matching, or opportunity analysis.

## Non-Goals

- Reconstructing the deleted legacy Discovery outputs as their original events.
- Automatically choosing a campaign for old Discovery leads.
- Creating an Opportunity Analysis service or a consumer for qualified-lead
  outputs.
- A complete, permanently hard-coded directory of all hospitality brands.

# Plan steps

## Step 1 — Establish the RabbitMQ transport contract and operational topology

**Status:** Done

### Objective

Add RabbitMQ as local/Docker infrastructure and establish the only public
Discovery-to-Qualification message contract before either service gains a
broker adapter.

### Observable result

Both services validate their own RabbitMQ runtime settings, RabbitMQ is
healthy in Docker Compose, and a versioned `lead discovered` contract can be
serialized and validated without importing a Discovery persistence document or
provider DTO.

### Implementation

1. Add a RabbitMQ service with a durable data volume, health check, and no
   management credentials committed to the repository. Wire Compose dependency
   readiness so MongoDB and RabbitMQ are independently observable.
2. Add only the service-owned RabbitMQ URL and non-secret transport settings to
   the root `.env` and `.env.example`; pass only the needed values to each
   service container. Validate the URI and bounded prefetch/retry settings in
   each service bootstrap.
3. Add a narrow `packages/contracts` package, only if both services can consume
   it without a build-time dependency on the other service. It must define the
   schema-versioned `DISCOVERED_LEAD` event, event ID, correlation ID,
   occurred-at timestamp, campaign ID, and provider-neutral lead snapshot.
   Reuse the existing version-1 output shape where compatible; document an
   explicit compatibility decision rather than silently changing it.
4. Define and document the topology: a durable topic exchange
   `discovery.lead.v1`, routing key `lead.discovered.v1`, a durable
   Qualification queue, bounded retry queues, and a durable dead-letter queue.
   Require persistent messages, publisher confirms, mandatory routing, manual
   consumer acknowledgements, and bounded prefetch.
5. Add structured readiness checks that distinguish an operating process from
   unavailable MongoDB or RabbitMQ. Include broker operation, campaign/event
   identifiers when available, duration, retryability, and redacted input in
   error logs.

### Verification

- Add contract parser/serializer tests for valid, missing, unknown-version,
  and malformed events.
- Start the Compose infrastructure, verify RabbitMQ and both existing health
  endpoints, then stop RabbitMQ and verify each readiness endpoint reports the
  broker dependency accurately without conflating it with liveness.
- Run lint, strict typecheck, tests, and build for both services.

### DoD

- The message contract is explicit, versioned, provider-neutral, and validated.
- RabbitMQ infrastructure and runtime configuration follow the root `.env`
  convention without leaking Discovery-only secrets to Qualification.
- No service has gained access to the other's MongoDB database.

### Done

- Added the independently buildable `@scout/contracts` package with the
  version-1, provider-neutral `DISCOVERED_LEAD` parser, serializer, and tests.
  The compatibility decision and the stable RabbitMQ exchange, queue, retry,
  and dead-letter topology are documented in
  `docs/RABBITMQ_TRANSPORT_CONTRACT.md`.
- Added durable RabbitMQ Docker infrastructure, per-service AMQP runtime
  validation, bounded transport settings, and TCP broker readiness probes.
  Readiness now reports MongoDB and RabbitMQ separately while liveness remains
  independent of both services.
- Verified contract lint/typecheck/tests/build; Discovery and Qualification
  lint/typecheck/tests/build; successful Compose build and startup; healthy
  readiness for both services; and the RabbitMQ-stop case where liveness stayed
  `ok` while readiness reported only `rabbitmq: unavailable`.

## Step 2 — Publish the Discovery outbox through RabbitMQ with recovery

**Status:** Done

### Objective

Turn the existing Discovery output record into a correctly recoverable outbox
publisher while preserving its deterministic identity and immutable snapshot.

### Observable result

Every pending output is eventually broker-confirmed or remains durably eligible
for retry; a crash can cause a duplicate message but cannot lose an output or
turn it into a new lead.

### Implementation

1. Extend the Discovery output domain and repository port with intent-oriented
   batch claim, release, confirmation, and retry methods. Add only the state
   required for an expiring publisher lease, attempt count, last failure, and
   confirmed publication timestamp. A stale lease must be reclaimable after
   restart.
2. Add MongoDB indexes and atomic conditional updates that prevent two workers
   from holding the same output claim. Keep `(campaignId, leadId)` and
   `outputId` uniqueness unchanged.
3. Add a Discovery outbound message-publisher port and a RabbitMQ adapter using
   confirms and mandatory routing. A confirm is the only event that may mark an
   output published. If the process dies after a confirm but before that write,
   publish again using the same `outputId`; this is the intended at-least-once
   boundary.
4. Add a restart-safe inbound worker/scheduler that invokes an application
   batch use case, not broker logic directly. Classify connection, routing,
   confirm timeout, and permanent payload/configuration failures explicitly;
   use bounded retry/backoff and structured logs.
5. Keep the output payload immutable. A refreshed canonical lead must neither
   alter an old event nor generate a second output.

### Verification

- Add domain/application tests for normal publish, duplicate confirm-after-
  crash, stale claim recovery, concurrent claim, transient broker outage, and
  mandatory-routing failure.
- Add MongoDB integration tests for output lease/index semantics and RabbitMQ
  integration tests against the local Compose service for persistent routing
  and publisher confirms.
- Run Discovery lint, strict typecheck, ordinary tests, integration tests, and
  build; run Qualification's existing quality gates.

### DoD

- Discovery never marks an output published before broker confirmation.
- A lost state update after confirmation is harmless to downstream processing.
- Discovery remains healthy and restart-safe when Qualification is stopped.

### Done

- Added durable output leases, publication attempt/failure data, retry timing,
  confirmation timestamps, atomic MongoDB claims, and selection indexes. A
  broker-confirmed output is marked `PUBLISHED` only by the matching lease
  holder; a missing state update leaves it reclaimable and therefore safe for
  at-least-once redelivery.
- Added the `amqplib` RabbitMQ publisher adapter with durable exchange
  declaration, persistent mandatory messages, publisher confirms, contract
  serialization, and routing/connection/confirmation/payload failure
  classification. Added a restart-safe scheduled publishing use case and
  structured failure logs with campaign, event, output, retry, and broker
  context.
- Added application, MongoDB, and RabbitMQ integration coverage for confirmed
  publication, retry persistence, confirm-state loss, concurrent/stale claims,
  mandatory routing, and persistent delivery. Verified Discovery remains ready
  while Qualification is stopped, then restored Qualification.

## Step 3 — Build Qualification's generic domain, profile configuration, and durable records

**Status:** Done

### Objective

Create the vertical-neutral Qualification core that can make, audit, and
reproduce deterministic decisions without RabbitMQ or Discovery imports.

### Observable result

Qualification selects a validated profile by campaign, evaluates a generic lead
snapshot, and persistently records `QUALIFIED`, `REJECTED`, or `INDETERMINATE`
with machine-readable reasons and the exact profile version.

### Implementation

1. Add independent Qualification domain, application, inbound-port, and
   outbound-port modules following the repository's hexagonal layout. Use
   generic concepts only: Lead, QualificationProfile, QualificationDecision,
   QualificationReason, and QualificationExecution.
2. Define enums for decisions, rule kinds, reason codes, input status, and
   output status. Compute and persist a stable profile content hash/version;
   a changed profile must allow a deliberate re-evaluation without rediscovery.
3. Add `config/qualification` campaign-to-profile configuration with fail-fast
   validation that names the file and field path. Start with generic rules
   supported by the present payload: required name, campaign-scoped explicit
   source-identity exclusions, website-host exclusions, and optional
   address/website/phone requirements. A missing optional business signal must
   produce `INDETERMINATE` when the profile requires it, not a hidden negative
   decision.
4. Add Qualification-owned Mongo repositories for received-message/inbox audit,
   execution claim, decision records, and delivery-ready qualified outputs.
   Enforce uniqueness at minimum for event ID and for
   `(campaignId, leadId, qualificationProfileVersion)`.
5. Persist a provider-neutral qualified-output snapshot through an explicit
   outbound port for the future Opportunity Analysis service. Do not design or
   operate its transport until that consumer has an explicit plan.

### Verification

- Add pure domain tests for every decision and reason, profile version change,
  required-field indeterminacy, and exclusion decisions.
- Add application tests with fakes for idempotency, duplicate events, a new
  profile version, and persistence failure.
- Add MongoDB integration tests for all required unique indexes and concurrent
  execution claims.
- Run Qualification lint, strict typecheck, tests, integration tests, and
  build; run Discovery's quality gates to prove independence.

### DoD

- Qualification has no hospitality-specific class, field, or service name.
- Every result is auditable with profile version and enum reason codes.
- Changing a profile does not require another Discovery run.

### Done

- Added the independent Qualification domain and application use case with
  deterministic `QUALIFIED`, `REJECTED`, and `INDETERMINATE` decisions,
  machine-readable reason enums, exact source-identity and website-host
  exclusions, and durable execution identity by campaign, lead, and profile
  version.
- Added validated `config/qualification/profiles.yaml`. Each profile has a
  stable canonical content hash and version; a new version deliberately
  re-evaluates an already-known lead without another Discovery run.
- Added Qualification-owned Mongo inbox, execution, decision, and qualified
  output repositories with uniqueness indexes and an atomic stale-claim
  recovery path. Qualified outputs are provider-neutral delivery-ready
  snapshots; no downstream transport was added.
- Added unit, application, and MongoDB integration coverage. Ran Qualification
  and Discovery lint, strict typecheck, tests, and builds. Rebuilt and started
  Qualification through Docker Compose; `/health/ready` reported MongoDB and
  RabbitMQ as ready.

## Step 4 — Consume Discovery events idempotently and emit qualification results safely

**Status:** Done

### Objective

Connect RabbitMQ to the Qualification inbound port without making the broker
the owner of business state or allowing an acknowledgement before durable work.

### Observable result

Qualification consumes broker messages, validates them before application code,
records one idempotent decision, and acknowledges only after that record is
safe. Malformed and terminally invalid messages are diagnosable and recoverable
from the dead-letter path.

### Implementation

1. Add a RabbitMQ inbound adapter that declares the agreed topology, sets
   bounded prefetch, propagates the correlation and message IDs, validates the
   contract at the boundary, and invokes the Qualification inbound use case.
2. Acknowledge only after inbox/execution/decision persistence succeeds. Treat
   a duplicate event or already-completed execution as a successful no-op and
   acknowledge it.
3. Route transient MongoDB or processing failures through bounded delayed retry
   queues. Route schema-invalid or permanently unsupported input to the DLQ
   with a sanitized failure record, error classification, and enough event
   identifiers for an operator to replay after correction. Do not endlessly
   requeue a poison message.
4. Add graceful shutdown behaviour: stop intake, finish or safely abandon the
   current delivery according to its durable claim, cancel consumer channels,
   and close broker and MongoDB connections.
5. Extend structured logs and readiness so an operator can identify broker
   message ID, event ID, campaign, lead ID, profile version, decision, attempt,
   duration, and error classification without payload secrets.

### Verification

- Add adapter tests for contract rejection, ACK-after-save ordering, duplicate
  delivery, transient retry, terminal dead-lettering, and graceful shutdown.
- Run an end-to-end local Docker path from a seeded Discovery outbox record to
  one persisted Qualification decision; redeliver the same message and prove
  there is still one execution.
- Run lint, strict typecheck, ordinary tests, integration tests, and builds for
  both services.

### DoD

- Consumer acknowledgement cannot make a lost decision appear completed.
- Redelivery is idempotent and auditable.
- Discovery and Qualification continue to have separate persistence ownership.

### Done

- Added a durable RabbitMQ consumer for the versioned Discovery contract. It
  declares the stable main, retry, and dead-letter queues, uses manual ACKs,
  bounded prefetch, and validates both the message envelope and matching AMQP
  message/correlation identifiers before Qualification application code.
- The consumer ACKs only after durable Qualification processing, including
  idempotent duplicate completion. Active executions are deferred through the
  bounded retry path rather than acknowledged, so a crashed worker cannot make
  an incomplete decision appear complete. Retry and dead-letter forwarding use
  publisher confirms before ACKing the original delivery.
- Added graceful intake shutdown with consumer cancellation, in-flight work
  completion, and broker connection closure. Structured logs now include
  broker message ID, campaign, lead, decision, profile version, attempt,
  duration, and failure classification.
- Added contract/handling tests for malformed input, durable completion,
  duplicates, active claims, retry, and terminal input. Ran both services'
  quality gates. A local Docker end-to-end run seeded a Discovery outbox event,
  observed broker-confirmed publication and one Qualification decision, then
  replayed the same event and confirmed one inbox, execution, and decision.

## Step 5 — Add the known-affiliation exclusion policy and first hospitality profile

**Status:** Done

### Objective

Implement a narrowly scoped, deterministic affiliation policy that can exclude
known branded hospitality properties for the first campaign without embedding
hospitality terminology or brand names in Qualification core code.

### Observable result

The first profile consistently rejects leads with unambiguous configured brand
affiliation, marks ambiguous evidence indeterminate, and records the exact
catalog entry and matching rule that caused the result.

### Implementation

1. Add a generic configuration-owned `known affiliation` catalog and a small
   pluggable policy behind a Qualification rule port. Core code may know only
   affiliation entries, aliases, website hosts, match strategies, and reason
   codes; hospitality-specific values stay in the profile/catalog YAML.
2. Validate a catalog entry's stable ID, owner label, aliases, host names,
   enabled state, effective revision, scope, and deterministic strategy. Define
   match strategies as enums, initially:
   - exact normalized full-name match;
   - exact token-sequence name match with defined boundaries;
   - exact website host or subdomain match.
   Normalization may case-fold and normalize Unicode/punctuation according to a
   documented deterministic algorithm; it must not use similarity scores, LLMs,
   fuzzy matching, or unbounded regular expressions.
3. Decision rules:
   - a configured website-host match is `REJECTED` with
     `KNOWN_AFFILIATION_WEBSITE_HOST`;
   - an unambiguous configured name match is `REJECTED` with
     `KNOWN_AFFILIATION_NAME`;
   - configured ambiguous aliases or partial evidence are `INDETERMINATE` with
     `POSSIBLE_AFFILIATION`;
   - no configured match is not proof of independence and lets later profile
     rules decide;
   - campaign configuration explicitly chooses whether franchise, management,
     collection, and soft-brand membership are excluded. The initial
     independent-property campaign excludes all four.
4. Seed the first catalog from official portfolios, recording source URL and
   catalog revision rather than treating this plan's examples as exhaustive:
   - Marriott International: Marriott, Courtyard, Sheraton, Westin, JW
     Marriott, Ritz-Carlton, St. Regis, W, Renaissance, Le Meridien, Four
     Points, Fairfield, AC, Aloft, Moxy, Residence Inn, and its collection
     brands. Marriott reports more than 30 brands, including Autograph,
     Tribute, and Design Hotels collections
     ([official portfolio](https://help.marriott.com/s/article/Article-24483)).
   - Hilton: Hilton, Waldorf Astoria, Conrad, LXR, Canopy, Curio, DoubleTree,
     Tapestry, Embassy Suites, Hilton Garden Inn, Hampton, Tru, Homewood,
     Home2, Motto, Spark, Graduate, NoMad, and LivSmart. Hilton's current
     portfolio page reports 28 brands
     ([official portfolio](https://stories.hilton.com/brands)).
   - IHG: Six Senses, Regent, InterContinental, Vignette, Kimpton, Hotel
     Indigo, voco, Ruby, HUALUXE, Iberostar, Crowne Plaza, Holiday Inn,
     Holiday Inn Express, Garner, avid, Atwell, Staybridge, and Candlewood
     ([official portfolio](https://www.ihgplc.com/en/our-brands)).
   - Accor: Orient Express, Raffles, Fairmont, Sofitel, MGallery, Banyan Tree,
     Pullman, Swissotel, Movenpick, Novotel, Mercure, TRIBE, Adagio, ibis,
     ibis Styles, and ibis budget, with the fuller list sourced from Accor's
     current brandbook/portfolio
     ([official portfolio](https://group.accor.com/en/brands-and-experiences/our-experience-portfolio)).
   - Hyatt: Park Hyatt, Grand Hyatt, Hyatt Regency, Hyatt, Hyatt Centric,
     Hyatt Place, Hyatt House, Andaz, Thompson, Alila, Miraval, Destination,
     Unbound, JdV, Dream, The Standard, Secrets, Dreams, Hyatt Ziva, and Hyatt
     Zilara ([official portfolio](https://www.hyatt.com/development/ourbrands)).
   - Wyndham, Choice, Radisson Hotel Group, BWH/Best Western, and Minor Hotels
     using their official portfolios. These include, respectively, Wyndham /
     Ramada / Days Inn / Travelodge; Comfort / Clarion / Quality Inn / Econo
     Lodge / Radisson; Radisson Blu / Park Plaza / Park Inn; Best Western /
     SureStay / WorldHotels; and Anantara / Avani / NH / NH Collection / nhow /
     Tivoli. See [Wyndham](https://corporate.wyndhamhotels.com/our-brands/),
     [Choice](https://www.choicehotels.com/choice-brands),
     [Radisson](https://www.radissonhotels.com/en-us/corporate/about-us/our-brands),
     [BWH](https://www.bestwestern.com/en_US/about.html), and
     [Minor](https://www.minorhotels.com/en/brands).
   - Add a separately reviewed GB/IE regional seed, including brands such as
     Premier Inn, Travelodge, Leonardo, easyHotel, Clayton, Maldron, Village,
     Macdonald, Britannia, Malmaison, and Hotel du Vin. Before activation,
     verify every alias and hostname against that brand's current official site
     and record the source/revision in configuration.
5. Treat collections and soft brands as an explicit policy decision, not an
   implementation accident: their properties can retain local ownership yet
   receive chain distribution/branding. The first campaign excludes them; a
   future profile may select a different affiliation-scope enum.
6. Add the remaining low-cost profile filters only where the transport schema
   has an explicit trustworthy fact: known source-identity or website-host
   exclusions, required contact fields, and campaign eligibility. Do not infer
   property type, country, operating state, rating, rooms, OTA presence, or
   website quality from the current free-form snapshot. A later explicit plan
   may add validated provider-neutral facts if those filters become necessary.

### Verification

- Add pure policy tests for every match strategy, Unicode/punctuation
  normalization boundary, host/subdomain matching, a collection/soft-brand
  profile option, no-match behaviour, and ambiguous evidence.
- Add configuration tests for duplicate aliases, invalid hosts, conflicting
  entries, invalid strategy/scope enums, and stale/disabled catalog entries.
- Add fixtures from the catalog without live brand lookups; inspect decision
  records to confirm entry ID, catalog revision, and reason code are retained.
- Run all Qualification and Discovery quality gates.

### DoD

- Brand data is versioned configuration, not generic application code.
- Every rejection is deterministic and explainable; no-match does not assert
  that a property is independent.
- The initial campaign's treatment of franchise, managed, collection, and
  soft-brand properties is explicit and tested.

### Done

- Added a generic, deterministic known-affiliation rule and configuration
  adapter. The core uses only catalog entry IDs, aliases, official hosts,
  match strategy, evidence, and affiliation scope; vertical data remains in
  YAML. Name normalization is Unicode NFKC plus case folding and bounded
  punctuation/token handling, without fuzzy matching or scores.
- Added the versioned catalog in `config/qualification/known-affiliations.yaml`
  with official portfolio URLs for global groups and separately reviewed GB/IE
  regional groups. The first profile explicitly excludes franchise,
  management, collection, and soft-brand scopes.
- Qualification records the matching catalog entry ID, catalog revision, and
  match strategy inside the structured decision reason. Confirmed official-host
  or name matches reject; configured ambiguous aliases are indeterminate; no
  match continues ordinary qualification and does not assert independence.
- Added pure policy/configuration tests and MongoDB audit-context coverage.
  Ran Qualification and Discovery lint, strict typecheck, tests, and builds;
  rebuilt Qualification in Docker Compose and verified readiness.

## Step 6 — Backfill existing Discovery leads through the normal outbox path

**Status:** Done

### Objective

Allow the operator to submit the currently stored leads to Qualification
without bypassing the Discovery outbox, RabbitMQ publisher, or Qualification
idempotency model.

### Observable result

An operator explicitly selects a target campaign and creates audited,
delivery-ready backfill outputs from selected canonical Discovery leads. The
ordinary publisher and consumer then handle them exactly like new outputs.

### Implementation

1. Add a Discovery-owned, non-interactive CLI/use case with mandatory target
   `campaignId`, explicit selection criteria, paginated deterministic ordering,
   dry-run mode, and an explicit confirmation flag. It must never default a
   campaign because the deleted outputs removed the historic membership data.
2. Persist one audited backfill-run record with operator-provided run ID,
   campaign, filter, count, timestamps, configuration/catalog context, and
   outcome. Log only bounded/sanitized identifiers.
3. Build a new current-state payload from the canonical Discovery lead and
   create the deterministic campaign/lead outbox identity. Mark it as a
   versioned backfill event or include an explicit event-origin enum so it is
   never represented as the original discovery-time snapshot. Do not publish
   directly from the CLI.
4. Reuse normal outbox uniqueness and publisher recovery. A repeated backfill
   run must create no second campaign/lead output and must be safe after a
   crash.
5. Document the required operator procedure: select campaign, preview count,
   run backfill, monitor outbox/publisher/queue/Qualification metrics, and
   reconcile decision count against the auditable run.

### Verification

- Add application and MongoDB integration tests for mandatory campaign
  selection, deterministic pagination, dry run, repeat run, interrupted run,
  and existing-output collision.
- Execute a local Compose smoke backfill against isolated test records and
  verify each selected lead produces one Qualification execution and decision.
- Run lint, strict typecheck, ordinary tests, integration tests, and builds for
  both services.

### DoD

- Old leads reach Qualification without cross-service database access or manual
  broker injection.
- Campaign attribution is operator-explicit and auditable.
- A backfill is idempotent and cannot pretend to recreate deleted history.

### Done

- Added the non-interactive `npm run backfill` Discovery CLI. It requires an
  explicit campaign, source kind, bounded count, operator run ID, Qualification
  catalog revision, and confirmation for an execution; it also supports dry-run
  and an optional literal lead-ID prefix for controlled subsets.
- Added deterministic canonical-lead pagination, an audited
  `discovery_backfill_runs` collection, and restart-safe reuse of the existing
  campaign/lead outbox uniqueness constraint. Backfill stores the Discovery
  configuration hash and Qualification catalog revision without Discovery
  reading Qualification persistence or configuration.
- Backfill writes a new current-state payload into the ordinary Discovery
  outbox with explicit `backfill` origin and run ID. The normal publisher and
  Qualification consumer remain the only transport path.
- Added application and MongoDB integration coverage for campaign/confirmation,
  deterministic paging, dry runs, existing-output collisions, repeat runs, and
  interrupted-run recovery. Documented the audited preview, execution,
  monitoring, and reconciliation procedure in `docs/DISCOVERY_BACKFILL.md`.
- Ran full Discovery and Qualification lint, strict typecheck, tests, and
  builds. In local Compose, dry-run selected two isolated leads; confirmed
  backfill created and published two outbox records, and Qualification produced
  exactly one execution and one qualified decision for each.

## Step 7 — Add controlled live Discovery budget and unique-yield stopping

**Status:** Done

### Objective

Run the real Discovery path only when the transport and Qualification flow are
ready, retain every discovered lead/output, and prevent low-yield provider
searches from consuming the plan's Apify allowance.

### Observable result

Each live provider batch has a durable budget record and a structured
unique-yield log. Discovery automatically pauses further paid collection after
at least 200 downloaded provider items when one or fewer unique source
identities were found, unless an operator deliberately starts a new approved
execution.

### Implementation

1. Add a dedicated, non-default, opt-in live-execution configuration and CLI
   for this plan. Ordinary service startup, schedulers, unit tests, builds, and
   RabbitMQ/Qualification tests must not start an Apify Actor.
   Add a root host-artifact directory
   `artifacts/discovery-live-executions/`, bind-mount it into the Discovery
   container for Docker execution, and configure its in-container path through
   Discovery runtime configuration. Add `artifacts/` to `.gitignore`; do not
   put live reports, provider data, or run identifiers in Git.
2. Persist the live-execution identity, configuration hash, operator-provided
   purpose, started/finished timestamps, run IDs, and cumulative provider-item
   usage in Discovery-owned storage. Enforce both limits before starting an
   Actor:
   - normal planned collection: at most 100 provider items in a calendar day;
   - exceptional plan allowance: at most 600 provider items and seven Actor
     runs in total for this plan.
   The exceptional allowance is an upper bound, not a target. An additional
   run beyond the ordinary daily amount requires the same explicit opt-in
   execution and must still fit the persistent plan allowance.
3. Keep the Actor request cap at no more than 100 provider items per run. The
   first real transport preflight may request at most 20 items; only after it
   has completed and the local end-to-end assertions pass may later runs use
   the remaining allowance. A possible maximum sequence is `20 + 100 + 100 +
   100 + 100 + 100 + 80`; it is never an obligation to reach 600.
4. After every imported provider batch, write a structured info log with
   `operation: discovery-unique-yield`, execution ID, campaign ID, scope ID,
   provider run ID, batch provider-item count, batch inserted-lead count,
   cumulative provider-item count, cumulative inserted-lead count, and
   `uniqueLeadRate`. Define the rate exactly as:

   ```text
   cumulative inserted source identities / cumulative downloaded provider items
   ```

   The denominator includes duplicate and otherwise non-new provider items,
   because those consume provider budget. The numerator is only leads whose
   durable `(sourceKind, externalId)` insertion succeeds for the first time.
   Also persist the same sanitized record outside Docker as an immutable,
   host-mounted artifact at
   `artifacts/discovery-live-executions/<execution-id>/batch-<sequence>.json`,
   with an execution manifest and final summary. Write each artifact
   atomically and do not start the next paid Actor run until it has been
   written successfully. If artifact writing fails, retain the Discovery
   database state, log an explicit persistence failure, and pause the live
   execution rather than risking an unauditable additional charge.
5. After each completed 100-item-or-smaller batch, evaluate the persisted
   cumulative rate only once at least 200 provider items have been downloaded.
   If `uniqueLeadRate <= 0.005` (0.5%), stop before starting another paid
   provider run. Thus 1 new source identity after 200 downloaded items reaches
   the stop condition, while a single 100-item batch never does.
6. Persist a named yield-threshold stop reason and pause the affected live
   execution/scope without marking it `DONE` or `FAILED`. Restarting the
   process must not bypass that pause. Resuming requires an explicit operator
   action and a documented new allowance/override; it must not be an automatic
   scheduler retry.
7. Continue using the existing deterministic source-identity constraint and
   immutable outbox outputs. Never delete discovered leads, outputs, or their
   state as part of budget control; later qualification delivery and backfill
   use those persisted records rather than downloading the same leads again.

### Verification

- Add application and persistence tests for the 100/day default, 600/7 hard
  allowance, 20-item preflight gate, process-restart recovery, and refusal of
  an unapproved Actor start.
- Add yield tests for: 0/100 (no evaluation yet), 1/200 (stop), 2/200 (do not
  stop), duplicate source observations, malformed provider records, and a
  restart after the threshold is reached.
- Inspect representative JSON logs and prove that each required batch and
  cumulative field is present and that the rate has the defined denominator.
  Verify the corresponding host artifact survives a Discovery container
  restart and is excluded by Git.
- Make no live Apify call solely for these tests. The first live call remains
  the 20-item preflight described above.

### DoD

- No normal command can spend Apify budget.
- The normal 100-item daily expectation and 600-item/7-run plan maximum are
  persistently enforced.
- The 0.5% cumulative unique-yield stop condition is deterministic,
  restart-safe, and visible in structured logs.
- Every live batch has an immutable sanitized audit artifact outside the
  Discovery container; an artifact-write failure pauses paid work.
- Previously downloaded leads remain available for delivery without repeated
  provider collection.

### Done

- Removed the Discovery collection worker from ordinary service startup; normal
  scheduler activity no longer calls Apify. Added the separate confirmed
  `npm run live:execute` command and the validated non-default
  `config/discovery/live-execution.yaml` policy.
- Added persistent live execution and plan-usage records. Provider starts are
  capped at 20 items for preflight, 100 per approved Actor run, 100 normal
  collection items per calendar day, and 600 items/seven runs for the plan.
- Added cumulative imported-item/unique-insertion tracking, structured
  `discovery-unique-yield` logs, threshold pause at 200 items and 0.5%, and a
  paused-scope state that cannot be claimed by ordinary recovery work.
- Added atomic host-mounted JSON batch artifacts under
  `artifacts/discovery-live-executions`, excluded them from Git, and paused a
  live execution on artifact-write failure. Added Compose mount, validated
  runtime configuration, and operator documentation in
  `docs/LIVE_DISCOVERY_EXECUTION.md`.
- Ran Discovery lint, strict typecheck, ordinary and integration tests, build;
  ran all Qualification quality gates; validated and rebuilt local Compose.
  No live Apify call was made.

## Step 8 — Verify recovery, operations, and the complete local delivery path

**Status:** Pending

### Objective

Prove that the combined system meets its durability, idempotency, observability,
and service-independence promises under normal and failure conditions.

### Observable result

An operator can trace a lead from Discovery outbox through RabbitMQ to its
Qualification decision, recover both services after interruption, and diagnose
transient versus terminal failures from structured logs.

### Implementation

1. Add local operational documentation for Compose start/stop, readiness versus
   liveness, queue/DLQ inspection, retry behaviour, safe replay, profile and
   catalog rollout, and backfill reconciliation.
2. Add metrics or structured operational summaries for pending/publishing/
   published Discovery outputs, RabbitMQ retry/DLQ counts, consumed events,
   duplicate deliveries, qualification decisions by enum, and backfill runs.
3. Exercise controlled failures: RabbitMQ unavailable, broker restart during
   publisher confirm, Discovery restart after confirm before persistence,
   Qualification restart before ACK, MongoDB unavailable, malformed event,
   poison event, duplicated message, and a temporarily stopped Qualification.
4. Perform the optional live Discovery verification only through Step 7's
   approved 20-item preflight and, when it passes, its remaining bounded
   allowance. Inspect the unique-yield log and verify that a threshold pause
   prevents the next Actor start.
5. Keep shutdown/recovery test data in explicit isolated databases and queues;
   do not perform any additional live Apify call.

### Verification

- Run full local Compose end-to-end tests for a new lead, a backfilled lead,
  and the Step 7 controlled live preflight when the plan reaches that point.
- Verify all controlled cases retain or safely redeliver work, produce the
  required diagnostic fields, and never create duplicate qualification
  executions for one profile version.
- Run `lint`, `typecheck`, `test`, `build`, and applicable MongoDB/RabbitMQ
  integration suites for both services; run `git diff --check`.

### DoD

- The complete path is restart-safe and at-least-once by design.
- All required persistence uniqueness guarantees are integration-tested.
- Operators have documented, non-destructive recovery and replay procedures.

# Plan completion criteria

This plan is complete only when all steps are `Done` and:

- Discovery publishes only broker-confirmed, versioned outputs through RabbitMQ.
- Qualification consumes at-least-once messages idempotently and records
  auditable deterministic decisions.
- Both services remain independently deployable and retain separate MongoDB
  ownership.
- The first campaign's known-affiliation catalog is validated, versioned, and
  explicitly defines its treatment of chain, franchise, managed, collection,
  and soft-brand properties.
- Existing leads can be backfilled only through an explicit, auditable,
  campaign-selected Discovery operation.
- Live provider collection remains opt-in, retains discovered records, logs
  unique yield after every batch, and cannot exceed 600 provider items or seven
  Actor runs for the plan. After 200 items, a cumulative unique yield at or
  below 0.5% pauses further paid collection.
- Each live batch also has a sanitized host-persisted audit artifact outside
  Docker and outside Git.
- Liveness, readiness, logging, graceful shutdown, retry, and DLQ behaviour
  are operationally verified.
- Both services pass lint, strict typecheck, tests, integration tests, and
  build; all live discovery-provider calls remain within Step 7's explicit
  opt-in 600-item/7-run allowance.
