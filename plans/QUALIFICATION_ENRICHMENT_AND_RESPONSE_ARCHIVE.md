# Actor Gateway and Qualification Enrichment Archive

## Goal

Introduce an independently deployable Actor Gateway microservice through which
every request to an external actor is made. The gateway owns exact-request
reuse, provider execution, complete raw-response retention, and a searchable
catalogue of observed response fields.

Route Discovery and Qualification through the gateway. Qualification will
obtain an incomplete, auditable commercial snapshot from
`solidcode/google-hotels-scraper`, without an interface or an automatic final
qualification decision in this plan.

## Current Context

- Discovery currently calls its Google Maps actor directly through an Apify
  client.
- Qualification already has its own MongoDB persistence and RabbitMQ consumer
  boundary. It must not read Discovery data directly.
- The documented output of `solidcode/google-hotels-scraper` includes nightly
  rates, reviews, rating, amenities, class, coordinates, description, Google
  identifiers, and images. It does not document room count, an official site,
  vendor ladders, or direct-versus-OTA prices.
- `@echospecter/proxy-gateway` is not present in this repository and its public
  API, licence, and operational model have not been verified.

## Target Direction

```text
Discovery  ─┐
            ├── Actor Gateway ── external actor provider
Qualification┘         │
                         ├── immutable raw response archives
                         └── observed-field catalogue
```

`apps/actor-gateway` is a separate generic Hexagonal microservice. It knows
providers, configured actors, requests, runs, response archives, and response
field paths. It does not know Leads, hotels, campaigns, qualification metrics,
or business decisions.

Discovery and Qualification each receive their own outbound Actor Gateway
client adapter. Provider-specific parsing remains inside the calling service's
outbound adapter: raw archived records never become provider DTOs in an
application port, domain entity, or cross-service message.

The optional `@echospecter/proxy-gateway` package may be used only as the
infrastructure implementation of a gateway client adapter, after its actual
contract is inspected. Neither domain nor application code may depend on it.

## Constraints

- Every actor request, including Discovery's Google Maps actor and
  Qualification's Google Hotels actor, passes through Actor Gateway.
- Actor Gateway owns a separate database and its collections. Discovery and
  Qualification never read or write those collections directly.
- Request reuse is exact, deterministic cache reuse; it is not Lead or entity
  deduplication, fuzzy matching, or a new identity system.
- The complete actor response is retained without field filtering or payload
  truncation. Large raw datasets are stored as immutable compressed archive
  bytes, not as unbounded MongoDB documents.
- Missing data is explicit. A missing rate, identifier, amenity, or field is
  never interpreted as zero or as a negative qualification result.
- Only Actor Gateway receives provider credentials such as `APIFY_API_TOKEN`.
  Calling services receive only their own typed gateway connection settings.
- The normal Docker Compose topology must start and recover all services
  without a special one-shot mode or manual message injection.
- Actor Gateway uses NestJS and MongoDB with the repository's existing native
  `mongodb` driver. The current Discovery and Qualification services do not
  depend on Mongoose; adding Mongoose would be a new persistence technology,
  not copying the existing stack, and is therefore outside this plan unless
  explicitly approved as an architecture change.
- The copied TypeScript and ESLint configuration is mandatory. New gateway code
  remains under the repository's strict typing rules, including no `any`, type
  assertions, or provider types beyond its outbound adapter.

## Initial Qualification Metrics

The initial Qualification projection contains exactly these six metrics:

1. **Public ADR** — the numeric nightly public rate from the retained actor
   result for the requested stay context.
2. **Review Volume** — provider review count.
3. **Market Price Position** — median-relative price position and/or percentile
   calculated from comparable results in the same retained market snapshot.
4. **Monetisable Asset Count** — count of configured commercial amenities.
5. **Full-Service Hotel Signal** — configured ordinal signal derived from
   commercial amenities.
6. **Market Value Proxy** — `publicAdr × log10(reviewVolume + 1)`, an internal
   ranking/display value rather than revenue or a decision.

`overallRating`, extracted class, coordinates, description, Google identifiers,
property token, images, all amenities, and every other actor field remain in
the raw archive and field catalogue. They are evidence or possible future
inputs, not additional initial metrics.

No other metric is included in this plan. In particular, metrics based on an
official site, vendor count, vendor prices, direct prices, or price spreads are
not projected because this actor does not document the required inputs.

Room count is not assumed to be available. If a future archived response does
contain it, the field catalogue will make that fact and its archive location
discoverable; a later projection can then use the retained raw record without
re-running that exact actor request.

## Actor Gateway Persistent Record Format

The exact physical MongoDB schema remains adapter-owned. The following logical
records are the required durable contract.

### Actor definition

One configured actor capability:

```text
actorDefinitionId
providerKind
actorId
actorRevision
inputSchemaRevision
configurationRevision
documentationUrl
enabled
```

### Canonical request

One logical, reusable input request:

```text
requestId
actorDefinitionId
canonicalInput
canonicalInputHash
cachePolicyRevision
reuseKey
status
createdAt
reusableUntil
```

`reuseKey` is calculated from the actor identity and revision, canonical input,
and cache-policy revision. Observability-only values such as calling service,
correlation ID, Lead ID, and display name are excluded. Semantically relevant
input such as search text or place identifier, dates, guests, children, locale,
currency, pagination, and market context is included. A persistent unique
index enforces this exact key.

### Provider execution and archive manifest

Each attempt against an actor provider is separate from the reusable request:

```text
runId
requestId
providerRunId
providerDatasetId
attempt
status
startedAt
finishedAt
archiveId
recordCount
responseSha256
```

The archive manifest points to immutable, compressed raw response bytes (for
example, GridFS when MongoDB document limits would be exceeded):

```text
archiveId
runId
contentType
contentEncoding
byteLength
sha256
recordBoundaryIndex
storedAt
```

The full dataset, including non-property records such as search metadata, is
retained exactly. A checksum and record-boundary index allow integrity checks
and retrieval of an individual raw record without scanning an entire dataset.

### Observed-field catalogue

Derived, generic metadata makes unused data discoverable without re-reading
every archive:

```text
actorDefinitionId
actorRevision
recordKind
jsonPointer
observedValueKinds
presentRecordCount
nonNullRecordCount
firstObservedArchiveId
lastObservedArchiveId
lastObservedAt
```

For example, an operator can query the catalogue for paths containing
`room`, inspect their coverage and concrete archive references, and then
retrieve the immutable raw record. The catalogue is evidence only: it never
replaces raw data or claims that a field has a stable provider guarantee.

Every projected Qualification value stores evidence sufficient for audit:
`archiveId`, raw-record position, JSON Pointer, extractor revision, requested
market/stay context, and source currency. This permits a future parser to
recover previously unused fields from the exact response that produced a
metric.

# Plan Steps

## Step 1 — Establish Actor Gateway contracts and package decision

**Status:** In Progress

### Objective

Define the generic inbound and outbound gateway contracts, deployment
configuration, and the supported use of `@echospecter/proxy-gateway`.

### Observable result

Actor Gateway can be independently built and started, reports liveness and
readiness, and exposes a versioned contract to resolve a request, observe its
status, inspect an archive manifest, and retrieve raw archived content.

### Implementation

- Inspect the package's actual published API, type declarations, licence,
  authentication model, retry semantics, and operational ownership before
  selecting it. If it does not provide a suitable typed client, implement a
  small local HTTP client adapter instead; do not invent package APIs.
- Add `apps/actor-gateway` with independent domain, application, ports, and
  adapters. Copy `.npmrc`, `tsconfig.json`, and `eslint.config.mjs` unchanged
  from an existing NestJS microservice before adding gateway-specific files so
  package resolution, strict compiler settings, and linting remain identical.
  Its public contracts are generic and versioned.
- Define a request-resolution contract and status/archive retrieval contracts.
  Include schema version, request ID, correlation ID, timestamps, actor
  definition/revision, and explicit status enums.
- Add typed environment configuration, structured logging, graceful shutdown,
  and separate health endpoints. Add Actor Gateway to normal Docker Compose.
- Add typed gateway runtime configuration and the necessary root `.env` and
  `.env.example` entries. Move the existing Apify token only in the Discovery
  migration step, so the running service is not reconfigured before its gateway
  replacement is verified.
- Add outbound Actor Gateway client adapters to Discovery and Qualification.
  If the package is selected, confine it to these adapters.

### Verification

- Unit-test contract validation and status transitions.
- Run Actor Gateway lint, typecheck, tests, and build.
- Start the Compose topology with a fake provider adapter and verify each
  service reaches readiness using only its own configuration.

### DoD

- Actor Gateway is independently runnable, uses the same strict TypeScript and
  lint configuration as the existing services, and exposes validated generic
  contracts.
- No provider SDK type, package API, or actor-specific DTO appears outside a
  gateway infrastructure adapter.
- Package use is evidence-based and contained to infrastructure adapters.

## Step 2 — Persist exact-request reuse, complete archives, and field catalogue

**Status:** Pending

### Objective

Implement the durable Actor Gateway request, execution, archive, and
observed-field records.

### Observable result

The same canonical request reuses a successful unexpired archive, while a
different stay date, guest count, locale, currency, actor revision, or cache
policy creates a distinct request. Full raw records and their field catalogue
survive a restart.

### Implementation

- Implement canonical input normalization, `reuseKey` creation, durable
  uniqueness indexes, and explicit cache/retry status transitions.
- Persist every provider execution attempt and immutable raw response archive;
  preserve both property and metadata rows.
- Generate the generic JSON-Pointer field catalogue after archival. Bound only
  diagnostic indexing work; never truncate the raw archive.
- Implement archive integrity verification, individual-record retrieval, and
  conflict-safe handling of concurrent identical requests.
- Define retention and cache-validity policy in validated configuration. A
  failed request must never masquerade as a reusable successful response.

### Verification

- Unit-test canonicalization, key stability, and changed-input invalidation.
- Integration-test unique-index concurrency, restart recovery, archive
  checksum validation, large payload storage, and field-catalogue discovery.

### DoD

- Exact reuse has a persistent, explainable key and a tested uniqueness
  guarantee.
- Full raw responses can be retrieved with an integrity check.
- An unused observed field can be located from the catalogue and traced to a
  raw archive record.

## Step 3 — Add an isolated, typed Apify provider adapter

**Status:** Pending

### Objective

Create the Apify adapter and actor-definition registry in Actor Gateway without
changing Discovery or Qualification runtime traffic.

### Observable result

Actor Gateway can translate a validated generic actor request to a configured
Apify actor operation in tests. Apify SDK types and input/output DTOs remain
inside that adapter.

### Implementation

- Add `apify-client` only to Actor Gateway and implement the provider adapter
  behind its generic outbound port.
- Register the existing Google Maps actor and
  `solidcode/google-hotels-scraper` as validated actor definitions with
  explicit configured revisions. Do not add hotel concepts to the generic
  gateway model.
- Map only the minimal provider operations required for a later execution:
  start run, read run status, and page dataset records. Return typed,
  provider-neutral run and dataset references from the adapter.
- Use fixture-driven adapter tests and an injected client seam; no live Apify
  call and no calling-service migration occurs in this step.

### Verification

- Adapter-test actor selection, canonical-input translation, start-status-page
  mapping, and provider DTO containment with sanitized fixtures.
- Run Actor Gateway lint, typecheck, tests, and build.

### DoD

- The Apify SDK is confined to Actor Gateway's outbound adapter.
- Both configured actors have validated generic definitions.
- No live provider call or change to Discovery/Qualification traffic occurred.

## Step 4 — Execute and archive a successful Apify run through the gateway

**Status:** Pending

### Objective

Connect the typed Apify adapter to the durable request, execution, archive, and
field-catalogue records established in Step 2.

### Observable result

For one successful gateway request, the provider run ID and dataset reference
are persisted, the full dataset is archived, and the generic archive contract
can return its manifest and raw records. Discovery and Qualification still use
their existing runtime paths.

### Implementation

- Implement the asynchronous gateway execution flow: resolve canonical request,
  start an Apify run, persist provider run/dataset references, poll a terminal
  status, page all dataset records, archive raw bytes, and build the observed
  field catalogue.
- Make every state transition restart-safe. A successful archived request is
  returned as a reuse candidate according to the configured cache policy.
- Preserve correlation ID, duration, attempt, actor revision, provider run ID,
  and dataset ID in structured logs. Do not log actor tokens or unbounded raw
  payloads.

### Verification

- Integration-test a successful run with a fixture Apify client, archive
  retrieval, checksum validation, field catalogue generation, and exact cache
  reuse.
- Run Actor Gateway lint, typecheck, tests, and build.

### DoD

- One successful provider execution is recoverable as a complete immutable
  archive through the generic gateway contract.
- The success path is proven without changing Discovery or Qualification.

## Step 5 — Add Apify failure handling and restart recovery

**Status:** Pending

### Objective

Make gateway-owned Apify execution safe under provider failures, duplicate
requests, and process restarts before any business service depends on it.

### Observable result

An interrupted or failed gateway execution has an explicit durable outcome.
After restart, Gateway resumes or re-observes the persisted provider run rather
than creating an accidental duplicate actor run.

### Implementation

- Map transient and permanent Apify failures to typed internal errors while
  preserving safe HTTP/provider code, retry-after data, provider run ID, and a
  bounded sanitized response context.
- Implement stale execution recovery and concurrent identical-request handling
  using the request and run records from Step 2.
- Treat a provider run whose terminal state is not yet known as pending; never
  serve it as a successful cache result.
- Add retry and terminal-failure logs with operation, actor revision, request
  ID, provider run ID, attempt, correlation ID, and retryability.

### Verification

- Integration-test transient failure, permanent failure, timeout, malformed
  provider response, process restart while a run is pending, and two callers
  resolving the same request concurrently.
- Run Actor Gateway lint, typecheck, tests, and build.

### DoD

- Gateway execution recovery does not start a duplicate provider run for the
  same durable in-progress request.
- Failed and pending requests cannot be reused as successful archives.
- Failure diagnostics are sufficient to determine the actor, request, run,
  attempt, and retryability from Docker logs.

## Step 6 — Migrate Discovery actor use to Actor Gateway

**Status:** Pending

### Objective

Route existing Discovery Google Maps acquisition through Actor Gateway without
altering Discovery's source-identity or scope semantics.

### Observable result

Discovery resumes scopes and emits new Leads as before, while every Google Maps
actor response is first archived and reusable through Actor Gateway.

### Implementation

- Replace Discovery's direct Apify invocation with its Actor Gateway outbound
  client adapter and retain Google Maps normalization within Discovery's
  outbound adapter.
- Move `APIFY_API_TOKEN` from Discovery to Actor Gateway and remove Discovery's
  direct `apify-client` dependency only after its gateway path has passed the
  required verification.
- Keep the existing source identity `(source kind, external id)`, durable scope
  progression, and downstream event contract unchanged.
- Handle pending gateway work, gateway outage, and completed reusable archives
  through explicit retryable application outcomes.

### Verification

- Application-test new, duplicate, and resumed-scope flows with a fake gateway.
- Integration-test restart behavior and at-least-once message delivery.
- Run Discovery lint, typecheck, tests, and build.

### DoD

- Discovery has no direct actor-provider request path or provider credential.
- Existing lead identity and idempotent publishing guarantees remain intact.

## Step 7 — Validate Google Hotels retrieval and local normalization

**Status:** Pending

### Objective

Integrate the selected Google Hotels actor through Actor Gateway and prove the
provider contract required by the six-metric projection.

### Observable result

Qualification can request or reuse an archived Google Hotels market snapshot,
then its outbound adapter extracts validated local data without provider DTOs
crossing the adapter boundary.

### Implementation

- Pin the actor ID and revision in Qualification configuration; configure stay
  context and market-query construction explicitly.
- Capture and validate representative `searchMetadata` and property records.
  Confirm record kinds, numeric rate representation, currency, omitted-rate
  behavior, amenity shape, reviews, identifiers, and property-token behavior.
- Verify whether the Discovery Google Maps identifier can be used as an actor
  input only from captured provider evidence. If not, record an explicit
  unmatchable/enrichment-indeterminate result; do not add fuzzy matching.
- Keep canonical actor input in the gateway; keep Qualification's local
  normalized snapshot and provenance separate from raw archive storage.

### Verification

- Add adapter fixtures for valid, missing-rate, missing-review, partial
  amenity, no-match, malformed, and provider-failure responses.
- Run a controlled opt-in live contract capture only after explicit budget and
  credentials are available; sanitize fixtures before committing them.

### DoD

- Qualification can distinguish unavailable data from a valid zero-like value.
- Every normalized value is traceable to a gateway archive and JSON Pointer.
- No identity heuristic or direct provider call is introduced.

## Step 8 — Project and persist the six auditable metrics

**Status:** Pending

### Objective

Persist the six configured metrics from a retained Google Hotels snapshot,
including their calculation context and evidence.

### Observable result

An operator or future interface can load an explicit, incomplete metric
snapshot and see each metric's value, availability, evidence, and calculation
context without re-calling an actor.

### Implementation

- Add a configuration-owned amenity catalogue for Monetisable Asset Count and
  Full-Service Hotel Signal. The generic platform core remains vertical-neutral.
- Calculate Market Price Position only from comparable priced results in the
  same archived market snapshot and price/currency context.
- Calculate Market Value Proxy with deterministic decimal-safe arithmetic and
  record the formula/extractor revision.
- Persist a qualification enrichment snapshot with explicit availability enum,
  actor/archive provenance, raw record location, JSON Pointer, extractor
  revision, stay context, market context, and source currency for every metric.
- Expose the snapshot through an inbound read port for a future interface. Do
  not implement that interface and do not introduce a deterministic final
  decision in this plan.

### Verification

- Domain-test six metric calculations, amenity catalogue behavior, currency and
  same-snapshot invariants, and missing-data semantics.
- Application-test persistence, repeat delivery, reusable archive behavior,
  and a later read of previously unprojected raw fields.
- Run Qualification lint, typecheck, tests, and build.

### DoD

- Only the six listed metrics are projected.
- Each metric is auditable and can be `AVAILABLE`, `UNAVAILABLE`, or
  `NOT_APPLICABLE` without inventing a commercial decision.
- Raw actor fields remain recoverable for future projections.

## Step 9 — Verify normal operations, recovery, and clean state

**Status:** Pending

### Objective

Prove the three-service Docker topology works in normal operation and leaves no
test data in any service database.

### Observable result

After a normal Compose start, Discovery can acquire through Actor Gateway and
Qualification can request/reuse, enrich, and persist a traceable six-metric
snapshot. Restarts preserve progress and archives. Final databases contain no
test fixtures.

### Implementation

- Add health/readiness dependency handling and graceful shutdown for the
  gateway-aware request lifecycle.
- Add an end-to-end fixture-provider path covering request resolution, raw
  archive, field catalogue, Discovery normalization, RabbitMQ delivery,
  Qualification enrichment, and restart recovery.
- Document normal compose startup, opt-in live capture, how to inspect archive
  manifests and field catalogue, and expected no-data outcomes.
- Update the root `ACTUAL_STATE.md` after the plan's final verification so it
  describes the implemented Actor Gateway, service inputs and outputs, and
  actual communication paths without presenting planned work as deployed.
- Remove only identified test records from `scout_actor_gateway`,
  `scout_discovery`, and `scout_qualification` after verification. Confirm
  collection counts rather than deleting broad database paths.

### Verification

- Run full lint, typecheck, test, and build for all services.
- Run the documented normal Docker Compose end-to-end flow and a restart test.
- Inspect structured logs for correlation propagation and inspect stored
  evidence from one fixture flow.
- Verify no test documents remain in the three service databases.

### DoD

- All services are independently runnable and work together in normal Compose.
- Gateway cache reuse, raw archive recovery, and six-metric provenance are
  proven end to end.
- `ACTUAL_STATE.md` reflects the verified post-plan topology and contracts.
- Test data has been removed and the removal has been verified.

# Plan Completion Criteria

- Every actor request in the platform passes through Actor Gateway.
- Raw provider data is retained intact, indexed generically, traceable, and
  available for future extraction without re-running an exact request.
- The selected Google Hotels actor produces only the six specified initial
  qualification metrics; unavailable inputs remain explicit.
- Discovery and Qualification remain independently deployable Hexagonal
  services with no direct provider calls or cross-database access.
- The normal Docker Compose path, recovery behavior, structured diagnostics,
  and clean test databases are verified.
