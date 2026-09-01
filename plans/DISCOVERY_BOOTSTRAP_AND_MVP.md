# DISCOVERY_BOOTSTRAP_AND_MVP.md

## Goal

Prepare the repository for two independently runnable NestJS microservices and implement the first working Discovery service.

The plan must:

- initialize `../discovery` and `../qualification` as independent NestJS applications without destroying the configuration files already placed there by the user;
- adapt the repository-level development setup to the fact that both services live one level below the repository root;
- use one root `.env` / `.env.example` for local development and Docker Compose;
- keep runtime configuration, databases, logs, and application boundaries independent per service;
- establish the Hexagonal Architecture required by `../AGENTS.md`;
- implement Discovery as a generic, configuration-driven lead discovery service rather than a hotel-specific application;
- use Apify Google Maps Scraper as the first Discovery provider;
- make Discovery restart-safe and idempotent so stopping the process, container, or host computer does not cause already discovered leads to be emitted again as new;
- automatically continue through configured geographic scopes without human intervention;
- leave Qualification initialized and operationally ready, but defer its business rules to a separate plan.

This is a bootstrap + Discovery MVP plan. It is not a plan for the entire lead-acquisition platform.

## Current source to inspect before implementation

The repository is expected to contain files equivalent to:

```text
/
├─ AGENTS.md
├─ .gitignore
├─ .env
├─ discovery/
│  ├─ .npmrc
│  ├─ eslint.config.mjs
│  ├─ tsconfig.build.json
│  └─ tsconfig.json
└─ qualification/
   ├─ .npmrc
   ├─ eslint.config.mjs
   ├─ tsconfig.build.json
   └─ tsconfig.json
```

The user has already created `../discovery` and `../qualification` and placed the TypeScript, ESLint, and npm configuration files in each directory.

The user previously placed `APIFY_API_TOKEN` into service-level `.env` files. The intended final convention for this repository is one root `.env`.

Do not trust the expected structure blindly.

At the beginning of implementation:

1. inspect the actual repository;
2. read `../AGENTS.md`;
3. inspect all existing root and service configuration files;
4. determine whether package files, Docker files, MongoDB configuration, plans, or other project infrastructure already exist;
5. update pending parts of this plan if the actual repository differs materially from the assumptions above.

Do not overwrite user-provided configuration files merely because Nest CLI would normally generate replacements.

## Target source structure

The intended structure after this plan is conceptually:

```text
/
├─ AGENTS.md
├─ .gitignore
├─ .env
├─ .env.example
├─ docker-compose.yml
├─ config/
│  └─ discovery/
│     └─ ...
├─ plans/
│  └─ DISCOVERY_BOOTSTRAP_AND_MVP.md
├─ discovery/
│  ├─ package.json
│  ├─ .npmrc
│  ├─ eslint.config.mjs
│  ├─ tsconfig.build.json
│  ├─ tsconfig.json
│  ├─ src/
│  │  ├─ domain/
│  │  ├─ app/
│  │  ├─ ports/
│  │  │  ├─ inbound/
│  │  │  └─ outbound/
│  │  └─ adapters/
│  │     ├─ inbound/
│  │     └─ outbound/
│  └─ test/
└─ qualification/
   ├─ package.json
   ├─ .npmrc
   ├─ eslint.config.mjs
   ├─ tsconfig.build.json
   ├─ tsconfig.json
   ├─ src/
   │  ├─ domain/
   │  ├─ app/
   │  ├─ ports/
   │  │  ├─ inbound/
   │  │  └─ outbound/
   │  └─ adapters/
   │     ├─ inbound/
   │     └─ outbound/
   └─ test/
```

This is a conceptual target, not permission to recreate files that already exist in another valid form.

Each microservice owns its source, package dependencies, runtime configuration mapping, and logical database.

## Environment convention

Use one root `.env` and one root `.env.example`.

The root `.env` is an operator convenience and does not change service ownership.

The expected direction is equivalent to:

```dotenv
DISCOVERY_PORT=3001
QUALIFICATION_PORT=3002

DISCOVERY_MONGODB_URI=mongodb://localhost:27017/scout_discovery
QUALIFICATION_MONGODB_URI=mongodb://localhost:27017/scout_qualification

APIFY_API_TOKEN=<real secret>
```

The example file must use:

```dotenv
APIFY_API_TOKEN=secret
```

Rules:

- do not keep duplicate service-level `.env` files after the root convention is established;
- local startup scripts/configuration must resolve the root `.env` deliberately;
- application code must not read `process.env` throughout the codebase;
- each service validates and maps only the variables it owns;
- Docker Compose may use the root `.env` for substitution, but must pass `APIFY_API_TOKEN` only to Discovery;
- Qualification must not receive the Apify token in its container environment;
- business targeting such as `hotel`, countries, scope priorities, or campaign rules belongs in config files, not `.env`.

## Discovery provider

The first provider is:

```text
Apify Actor: compass/crawler-google-places
```

Use the official `apify-client`.

Production Discovery must use the asynchronous Actor lifecycle:

```text
start Actor
    ↓
persist run ID
    ↓
check existing run on later worker cycles
    ↓
read completed dataset in bounded batches/pages
```

Do not make a country-sized Discovery operation depend on one long-lived local HTTP request.

The provider token is already available to the user and will be stored as:

```text
APIFY_API_TOKEN
```

The implementation must never log the token.

## Cost and live-provider safety contract

Discovery must have an explicit provider-consumption budget. The budget is based on scraped provider items, not newly inserted leads, because provider cost may be incurred even when a returned place is already known.

Initial production defaults for the first campaign:

```yaml
limits:
  dailyProviderItemLimit: 100
  maxProviderItemsPerRun: 100
```

These are campaign/runtime business limits and belong in validated Discovery configuration, not environment variables.

The initial `500` places/day limit is intentionally conservative. At the current base price of the selected Actor, approximately $1.50 per 1,000 scraped places before optional paid add-ons, this corresponds to approximately $0.75/day or $22.50 per 30-day month at the base scraping price. Provider pricing may change, so the implementation must enforce the item quota rather than hardcode a monetary assumption.

Rules:

1. Count provider items against the daily quota whether they become new leads, duplicates, rejected records, or later fail Qualification.
2. Persist daily quota consumption; process memory must not be the source of truth.
3. Use a deterministic quota window. Use UTC calendar days unless a later explicit requirement changes the policy.
4. When the daily quota is exhausted:
   - do not start another paid provider run;
   - do not mark the current scope Done merely because the quota was reached;
   - persist enough state to continue later;
   - enter an explicit budget-exhausted/idle outcome;
   - resume automatically when the next quota window becomes available.
5. Reserve quota before starting a paid Actor run so concurrent workers cannot collectively exceed the intended daily allowance.
6. `maxCrawledPlacesPerSearch` is a per-search-term Actor limit. If a run contains multiple search terms, construct the input so the theoretical maximum number of returned places across all search terms cannot exceed the quota reserved for that run.
7. `maxProviderItemsPerRun` is a hard upper bound for normal production runs. The first implementation should prefer smaller resumable runs/scopes rather than one very large paid request.
8. Optional paid add-ons remain disabled in Discovery. Enabling an add-on requires a separate explicit plan change because item-count budgeting alone may no longer predict cost adequately.
9. Do not rely only on an Apify account-wide spending limit. Discovery must enforce its own persisted application-level quota.

### Real Apify calls during development

Real Apify access is allowed during implementation, but it is deliberately scarce.

The live-call budget for execution of this plan is:

```text
Contract capture:
  maximum live Actor runs: 1
  maximum places requested: 10

Live E2E:
  maximum live Actor runs: 4
  maximum places requested per run: 20

Total plan allowance:
  maximum live Actor runs that actually start: 5
  maximum requested places across those runs: 100
```

A retry counts as another live run if an Actor run was successfully started. A failure before a paid Actor run is created does not consume the run allowance.

Rules:

1. Unit tests must never call real Apify.
2. Normal adapter tests must never call real Apify.
3. Normal integration tests must never call real Apify.
4. The ordinary `test` command must never make paid network calls.
5. Capture the real provider contract once with at most 10 places, sanitize the response, and store only the minimum representative fixture data required for parser/adapter tests.
6. After the contract fixture exists, unit/adapter/integration tests use fake ports or sanitized fixtures.
7. Live E2E tests must be behind an explicit opt-in command or flag and must not run as part of normal `test`, `build`, CI, or editor test discovery.
8. Every live E2E Actor input must contain an enforced maximum of 20 places for the run. Do not trust a caller-supplied value larger than the test safety cap.
9. Do not run a full-country crawl while implementing or verifying this plan.
10. Before every real paid call, log an info-level sanitized record containing:
    - that the call is live/paid;
    - purpose (`contract-capture` or `e2e`);
    - requested maximum places;
    - current plan live-run count when tracked by the implementation/test harness;
    - no secrets.
11. If the plan-level live-call allowance would be exceeded, stop and report the condition instead of making another real request.
12. Provider contract refresh in future work must be an explicit action; ordinary test execution must not silently refresh fixtures.

## Important constraints

1. Follow `../AGENTS.md` strictly.
2. Use NestJS and Hexagonal Architecture in both microservices.
3. `discovery` and `qualification` must be independently runnable and independently buildable.
4. One physical MongoDB instance may be used, but each service owns a separate logical database.
5. Direct cross-service database access is forbidden.
6. Use generic lead terminology. Core Discovery code must not contain hotel-specific entities such as `Hotel` or `HotelId`.
7. Discovery behavior is configuration-driven.
8. The initial campaign may search for hotels, but changing the campaign to cinemas or another category must not require changing the Discovery application architecture.
9. Discovery uses one authoritative provider in this plan.
10. Source identity is deterministic and based on the provider kind plus provider external ID.
11. Do not implement fuzzy matching, similarity percentages, probabilistic deduplication, or LLM-based entity resolution.
12. Database uniqueness constraints, not in-memory collections, must enforce Discovery identity.
13. Discovery must survive process restart, Docker restart, and host reboot.
14. Persist enough provider/scope/import state to continue work after restart.
15. A repeated provider result must not be emitted again as a newly discovered lead.
16. Discovery must automatically advance to the next configured scope when the current scope is complete.
17. Keep Discovery cheap. Do not enable reviews, screenshots, contact discovery, deep website crawling, OTA analysis, or other expensive enrichment.
18. Enforce the configured daily provider-item quota and per-run provider-item cap before paid work is started.
19. Real Apify calls during development must obey the live-call budget defined in this plan; ordinary automated tests must not call Apify.
20. Provider-specific Apify DTOs must remain inside the Apify outbound adapter.
21. Use strict TypeScript according to `../AGENTS.md`: no `any`, no `as` assertions, no `object` type, and no TypeScript suppression directives.
22. Runtime failures must be diagnosable through structured logs, including service, class, method, operation, correlation ID, relevant campaign/scope/run IDs, sanitized input, retryability, original error, and stack trace.
23. Qualification business rules are explicitly outside this plan.
24. Production transport from Discovery to Qualification is explicitly outside this plan. Discovery must nevertheless persist a durable provider-neutral output record for each genuinely new lead so a later transport adapter can publish it safely.
25. Do not add a second discovery source during this plan.
26. Do not make unrelated repository refactors.

---

# Plan steps

## Step 1 — Inspect the repository and bootstrap both NestJS microservices

**Status:** Done

### Objective

Establish the real repository baseline and turn the existing `../discovery` and `../qualification` directories into clean, independently runnable NestJS services without destroying user-provided configuration.

### Observable result

- The actual repository structure is understood and documented in this plan's execution record.
- Both microservices have valid NestJS bootstrap code and package configuration.
- Existing `.npmrc`, ESLint, and TypeScript configuration is preserved unless a required change is explicitly justified.
- Both services can be installed, typechecked, tested, built, and started independently.

### Implementation

1. Read `../AGENTS.md` and this plan.
2. Inspect the complete repository tree and existing root/service files before generating anything.
3. Inspect the contents of:
   - root `../.gitignore`;
   - both `.npmrc` files;
   - both `eslint.config.mjs` files;
   - both `tsconfig.build.json` files;
   - both `tsconfig.json` files;
   - any existing `package.json`, Docker, MongoDB, or plan files.
4. Initialize the minimum NestJS application structure inside each service.
5. Do not use Nest CLI in a way that blindly replaces existing configuration.
6. Establish the required Hexagonal Architecture directories in each service.
7. Keep initial NestJS modules/bootstrap deliberately small; do not generate example business modules that will immediately be deleted.
8. Adapt the root `../.gitignore` for nested microservices, including nested `node_modules`, build output, coverage, logs, temporary files, and the root `.env`.
9. If actual repository paths differ from this plan, update pending plan references before continuing.
10. Review the next three pending steps against the real repository state before marking this step Done.

### Verification

Run the appropriate commands independently from each service and confirm:

```text
install
lint
typecheck
test
build
start
```

Use the actual package-manager commands established by the repository.

### DoD

- Both NestJS applications start independently.
- Both compile in strict TypeScript mode.
- Both have the required Hexagonal Architecture directory structure.
- Existing user configuration was not silently replaced.
- Root `../.gitignore` correctly handles the multi-service repository.
- The actual baseline and any deviations from the expected structure are recorded in this step's Done section.
- The next three pending steps have been reviewed against the real repository.

### Done

- The actual baseline contained the root guidance and plan files, root `.env` files and `.gitignore`, plus only `.npmrc`, ESLint, and TypeScript configuration in `discovery/` and `qualification/`. Neither service had package metadata, source code, Docker/MongoDB setup, nor existing application files.
- Preserved the supplied service configuration and added `strict: true` to both TypeScript configurations to meet the strict-mode requirement. The source layout produces `dist/main.js`, so each package starts that generated entry point directly.
- Added isolated NestJS package manifests and lock files, ESM Jest configuration, minimal bootstrap modules, independent tests, and the prescribed Hexagonal Architecture directory roots in both services. Discovery listens on port 3001 and Qualification on port 3002 pending typed runtime configuration in Step 2.
- Updated the root `.gitignore` to ignore nested build output, dependencies, coverage, logs, and temporary directories while retaining the existing root environment-file handling.
- Verified independently in both service directories: `npm install`, `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, and `npm run start`. Each start command opened its expected listening port and was then stopped.
- Reviewed Steps 2–4 against the baseline. Their assumptions remain valid: Step 2 must establish the root environment, operational adapters, and MongoDB ownership; Step 3 can add Discovery configuration and durable state on that foundation; Step 4 depends on the state and ports introduced by Step 3. No pending-plan changes are required.

---

## Step 2 — Establish root environment, service configuration, MongoDB ownership, and operational baseline

**Status:** Done

### Objective

Make both microservices operationally predictable before Discovery business logic is added.

### Observable result

Both services use the root environment convention, validate their own runtime configuration, use separate MongoDB databases, expose health state, shut down cleanly, and produce useful structured logs.

### Implementation

1. Replace service-level `.env` usage with one root `.env` and `.env.example`.
2. Preserve the existing real `APIFY_API_TOKEN` by moving it to the root `.env`; do not print or copy the token into logs, plans, fixtures, or source.
3. Configure local startup so both services deliberately resolve the root `.env`.
4. Configure Docker Compose, if it does not already exist, with the minimum required local infrastructure:
   - MongoDB;
   - Discovery;
   - Qualification.
5. Use separate logical databases:
   - `scout_discovery`;
   - `scout_qualification`.
6. In Docker, pass `APIFY_API_TOKEN` only to Discovery.
7. Implement service-specific validated runtime configuration.
8. Add structured JSON logging with centralized secret redaction.
9. Ensure application errors can include class, method, operation, correlation ID, sanitized input, relevant identifiers, retryability, cause, and stack.
10. Add liveness and readiness endpoints.
11. Configure graceful NestJS/Docker shutdown.
12. Keep infrastructure/framework code inside the proper adapters/bootstrap boundary.
13. Review the next three pending steps before marking this step Done.

### Verification

- Start MongoDB and each service independently.
- Confirm Discovery connects only to `scout_discovery`.
- Confirm Qualification connects only to `scout_qualification`.
- Stop Qualification and verify Discovery remains healthy.
- Trigger one controlled startup/configuration failure and verify the logs identify the precise cause without leaking secrets.
- Send `SIGTERM`/stop the container and confirm clean shutdown.

### DoD

- One root `.env` / `.env.example` convention is working.
- Duplicate service-level `.env` files are no longer required.
- Qualification does not receive the Apify secret in Docker.
- Both services have validated typed configuration.
- Both services have useful structured logs.
- Liveness, readiness, and graceful shutdown work.
- Database ownership is physically separated by logical database.
- The next three pending steps have been reviewed.

### Done

- Established the root `.env` and `.env.example` convention with service ports, MongoDB host ports, and separate `scout_discovery` / `scout_qualification` URIs. Discovery alone validates and consumes `APIFY_API_TOKEN`; no service-level `.env` files exist.
- Added service-owned validated runtime-configuration adapters that load the root environment locally and honour Docker-injected values. Invalid fields fail fast with the environment-file path, field name, reason, structured context, and stack trace without logging secret values.
- Added Docker Compose with MongoDB and independent Discovery/Qualification images. Compose injects only Discovery's non-secret runtime values plus the Apify token; Qualification has no Apify environment entry.
- Added independent MongoDB adapters, `/health/live` and `/health/ready` endpoints, structured JSON stdout/stderr logging with recursive known-secret redaction, and Nest graceful-shutdown hooks in both services.
- Corrected the TypeScript output layout so each service deterministically builds and starts `dist/adapters/inbound/http/main.js`.
- Verified both services with `npm run lint`, `npm run typecheck`, `npm run test`, and `npm run build`. Controlled invalid-port startup checks produced structured errors with the failed field and stack trace, without exposing secrets.
- Built and started the full Compose stack. MongoDB became healthy; both services returned `ok` from liveness and readiness. Ping checks succeeded independently for `scout_discovery` and `scout_qualification`.
- Stopped Qualification with Docker Compose: its log recorded `onModuleDestroy` and MongoDB close after `SIGTERM`; Discovery remained live and ready. Qualification was restarted and its health checks returned `ok` again.
- Reviewed Steps 3–5 against the live baseline. Step 3 can now build its domain and persistence ports on the verified MongoDB adapter foundation; Step 4 depends on the persistent records from Step 3; Step 5 remains correctly deferred until the generic port and state model exist. No pending-plan changes are required.

---

## Step 3 — Define Discovery configuration, domain model, ports, and persistence

**Status:** Done

### Objective

Create the generic Discovery core and persistent state model before integrating Apify.

### Observable result

Discovery understands campaigns, configured scopes, generic leads, source identity, provider runs, and persistent progress without depending on Google Maps, Apify SDK types, MongoDB types, or hotel-specific domain code.

### Implementation

1. Create the root `config/discovery/` source of business configuration.
2. Define and validate a minimal Discovery campaign configuration containing:
   - campaign ID;
   - source kind;
   - source non-secret configuration;
   - search queries;
   - ordered/prioritized scopes;
   - optional future rescan settings where justified.
3. Add an initial configuration suitable for the current hotel campaign without encoding hotel semantics into generic TypeScript classes.
4. Add validated cost-control configuration with initial defaults equivalent to:
   - `dailyProviderItemLimit: 500`;
   - `maxProviderItemsPerRun: 100`.
5. Define the minimum Discovery domain concepts:
   - `Lead`;
   - source identity;
   - discovery campaign reference;
   - discovery scope;
   - scope status;
   - provider run reference/status;
   - import progress.
6. Use enums for every closed set.
7. Define narrow inbound ports for advancing Discovery work.
8. Define outbound ports for:
   - lead persistence;
   - discovery-scope/progress persistence;
   - provider access;
   - durable output persistence;
   - daily provider-quota persistence/reservation;
   - time where explicit time access is required.
9. Implement MongoDB adapters for leads, discovery state, and persisted provider-quota usage.
10. Enforce a unique persistent source identity using `(sourceKind, externalId)`.
11. Support atomic claiming of the next eligible scope.
12. Support atomic reservation/consumption of the configured daily provider-item quota.
13. Persist provider run reference, dataset reference when available, import progress, attempts, timestamps, and terminal failure context.
14. Add integration tests for source uniqueness, repeated upsert, atomic scope claiming, persisted progress, and concurrent daily-quota reservation.
15. Review the next three pending steps before marking this step Done.

### Verification

- Load valid and invalid campaign configurations and verify startup validation.
- Attempt to insert the same source identity repeatedly and confirm only one lead identity exists.
- Simulate concurrent scope claims and confirm only one worker obtains the same scope.
- Restart the application against the same database and confirm persisted scope state is unchanged.
- Attempt concurrent quota reservations near the daily limit and confirm the configured daily allowance cannot be exceeded by successful reservations.

### DoD

- Discovery domain code has no NestJS, MongoDB, Apify, or hotel-specific dependency.
- Campaign behavior comes from validated config.
- Persistent uniqueness enforces source deduplication.
- Scope state is durable and atomically claimable.
- Daily provider quota is durable and atomically reservable.
- Core persistence integration tests pass.
- The next three pending steps have been reviewed.

### Done

- Added `config/discovery/campaign.yaml` as the root source of Discovery business configuration. It contains the initial vertical-specific search query only as configuration, two prioritized geographic scopes, `google-maps` as the source kind, the configured actor identifier, a daily provider-item limit of 500, and a per-run limit of 100.
- Implemented strict YAML parsing and validation with exact file and field paths, validation of unique scopes and bounds, and a stable SHA-256 configuration hash. The loader supports both local development and the Compose-mounted configuration path.
- Added provider-neutral Discovery domain models for campaign references, source identity, leads, scope progress, provider run state, import progress, terminal failure context, and all closed state sets as enums. Domain code has no NestJS, MongoDB, Apify, or hotel dependency.
- Added narrow inbound/outbound contracts for scope claiming, lead persistence, discovery state, provider access, durable output, daily quota reservation, and time.
- Implemented MongoDB adapters with correctness indexes: unique `(sourceKind, externalId)` lead identity; unique campaign/scope state; deterministic priority claim index; unique campaign/day quota usage; and unique durable output identities. Scope claims use atomic `findOneAndUpdate`; quota reservation first ensures the usage record and then atomically increments only within the configured limit.
- Added MongoDB integration tests covering repeated source upsert, concurrent scope claims, persisted provider/import progress across repository reconstruction, and concurrent quota reservation. The integration test uses only `scout_discovery_step3_integration` and drops that explicit test database on completion.
- Verified Discovery with `npm run lint`, `npm run typecheck`, `npm run test`, `npm run build`, and `npm run test:integration`; verified Qualification's lint, typecheck, tests, and build; rebuilt Discovery in Compose; confirmed health endpoints; and inspected the live unique source-identity index.
- Reviewed Steps 4–6. Step 4 can now synchronize configured scopes and drive the established atomic claim/quota ports. Step 5 can implement the provider behind the already-defined provider port. Step 6 can consume the existing upsert, progress, and durable-output repositories. No pending-plan changes are required.

---

## Step 4 — Implement restart-safe Discovery orchestration and automatic scope progression

**Status:** Done

### Objective

Make Discovery able to continuously progress through configured scopes using persistent state rather than process memory.

### Observable result

Discovery can claim the next scope, start/resume its current unit of work, become idle when nothing is eligible, and automatically continue from one completed scope to the next without human intervention.

### Implementation

1. Implement synchronization from campaign config into persisted scope state.
2. Do not reset already completed scopes during normal restart/config reload.
3. Allow newly added configured scopes to become eligible without manual database edits.
4. Implement deterministic next-scope selection according to configured order/priority.
5. Implement a worker/scheduler inbound adapter whose only responsibility is to trigger the application use case.
6. Keep scheduling logic out of the domain and application decision rules.
7. Prevent unsafe overlapping ticks within one process.
8. Rely on persistent atomic claiming, not in-memory flags, for correctness across process instances.
9. Represent “no eligible work” as an explicit idle outcome, not an exception.
10. Before starting paid provider work, obtain a persisted quota reservation bounded by both the remaining daily allowance and `maxProviderItemsPerRun`.
11. When the daily quota is exhausted, produce an explicit budget-exhausted/idle result and resume automatically in the next UTC quota window without marking the current scope Done.
12. Define and test state transitions needed for:
    - pending work;
    - active provider work;
    - import-ready work;
    - importing work;
    - completed work;
    - terminal provider failure.
13. Verify that completing one scope makes the next configured scope eligible automatically.
14. Review the next three pending steps before marking this step Done.

### Verification

Use fake provider/outbound ports to verify:

- first scope is selected deterministically;
- duplicate worker ticks do not claim the same work twice;
- completed scope is not restarted after process restart;
- after the first scope completes, the next scope is selected;
- after all eligible scopes complete, the worker becomes idle;
- exhausting the daily provider quota pauses paid work without completing the active scope;
- the next UTC quota window makes the paused work eligible again automatically.

### DoD

- Progression depends on persisted state.
- No human action is needed to move from one configured country/scope to the next.
- Restarting the process does not reset completed work.
- Exhausting the daily provider quota cannot start additional paid work until the next quota window.
- Worker orchestration is tested independently from Apify.
- The next three pending steps have been reviewed.

### Done

- Added `DiscoveryProgressService`, which synchronizes campaign configuration into durable scope records without resetting terminal scopes, atomically claims the configured lowest-priority pending scope, and returns explicit `scope-claimed`, `idle`, or `budget-exhausted` outcomes.
- New config scopes are inserted as `PENDING`; existing scopes retain their lifecycle state while receiving the current configuration hash and priority. The MongoDB adapter can atomically release an unstarted claim after budget exhaustion, so it never marks the scope Done or strands it in Running.
- Extended persisted quota reservation to reserve at most the remaining daily allowance atomically, including a partial final reservation when the remaining allowance is lower than the per-run cap.
- Added explicit domain transitions for active provider work (`RUNNING`), importing, completion, and terminal failure, each with invariant checks.
- Added a Nest scheduler adapter with a one-process overlap guard. It is only a driving adapter; cross-process correctness continues to rely on persistent atomic claims and quota updates.
- Added fake-port application tests for deterministic first-scope selection, overlapping ticks, restart-safe completed scopes, next-scope selection, idle behavior, budget exhaustion/release, next-UTC-window eligibility, and state-transition invariants. These tests do not invoke Apify.
- Verified Discovery with lint, strict typecheck, all tests, build, and persistence integration tests; verified Qualification's lint, strict typecheck, tests, and build.
- Reviewed Steps 5–7. Step 5 can attach Apify behind the existing provider port and use the reserved quota passed forward by Step 4. Step 6 can turn those run states into idempotent import/output behavior. Step 7 will validate controlled provider and persistence failures once those adapters exist. No pending-plan changes are required.

---

## Step 5 — Integrate Apify Google Maps Scraper behind the Discovery provider port

**Status:** Done

### Objective

Connect Discovery to the real Apify Google Maps Scraper without leaking provider-specific APIs into the application core.

### Observable result

Discovery can start a Google Maps Scraper Actor run asynchronously, persist its run reference, inspect an existing run after restart, and read completed dataset items in bounded pages.

### Implementation

1. Confirm `APIFY_API_TOKEN` exists in the root runtime environment before making paid/integration calls.
2. If the token is missing, stop only this integration step and ask the user to place it in the root `.env`; never ask the user to paste the token into chat.
3. Install the official `apify-client` only in Discovery.
4. Implement an outbound adapter for:
   - Actor `compass/crawler-google-places`;
   - asynchronous Actor start;
   - existing run status lookup;
   - bounded dataset reads.
5. Keep the Actor ID in Discovery source configuration rather than a secret environment variable.
6. Map provider statuses into internal enums.
7. Keep Apify DTOs and errors inside the outbound adapter.
8. Normalize useful provider error information into internal typed errors, including run ID, status/code, retryability, and bounded sanitized provider context.
9. Define the first cheap Actor input from the campaign configuration:
   - search query;
   - geographic scope;
   - no unnecessary reviews;
   - no screenshots/images;
   - no contact/social enrichment;
   - no expensive unrelated enrichment.
10. Map the application quota reservation into a safe Actor input. Because `maxCrawledPlacesPerSearch` applies per search term, ensure the theoretical maximum across all search terms does not exceed the quota reserved for that run.
11. Add a dedicated contract-capture command/configuration that is explicitly live and paid, uses a bounded area, and hard-limits the Actor to at most 10 places.
12. Execute at most one live contract-capture Actor run during this plan.
13. Sanitize that real response and save the smallest representative fixture needed to understand and test the current provider contract.
14. Implement strict runtime parsing of provider dataset items from `unknown`, without assertions.
15. Normalize only the fields needed for generic Discovery identity and cheap downstream qualification.
16. Make all normal Apify adapter tests use the sanitized fixture; they must not call the live provider.
17. Add a dedicated opt-in live E2E path whose Actor input is hard-limited to at most 20 places and which cannot run as part of ordinary tests/build/CI.
18. Review the next three pending steps before marking this step Done.

### Verification

- Start the one permitted contract-capture Actor run with a maximum of 10 places and persist its real run ID.
- Retrieve the same run through the persisted ID.
- Read its dataset through the adapter in bounded pages.
- Run normal adapter tests with live network access disabled and confirm they use only sanitized fixtures.
- Verify the token never appears in logs.
- Verify a malformed fixture produces a precise typed/logged error or explicit skip reason.
- Verify no Apify SDK type crosses the outbound adapter boundary.

### DoD

- Real Apify integration works through the outbound port.
- Actor execution is asynchronous from the local service lifecycle.
- Run IDs can be revisited after service restart.
- Dataset reading is bounded.
- Real provider output is strictly parsed.
- Ordinary automated tests do not make paid provider calls.
- Contract capture and live E2E have separate hard safety caps.
- Expensive enrichment remains disabled.
- The next three pending steps have been reviewed.

### Done

- Added the isolated `ApifyGoogleMapsProviderAdapter` backed by the official `apify-client`. It starts `compass/crawler-google-places` asynchronously, maps the Actor lifecycle into the internal provider-status enum, and reads dataset items with explicit offset/limit pages. Apify DTOs remain inside the adapter.
- The Actor input is constructed from the configured source, scope, and queries. It divides the reserved run maximum across queries, and explicitly disables web results, images, contacts, directories, place-detail crawling, social profiles, competitor analysis, and lead enrichment.
- Added typed `ApifyProviderError` and `ApifyProviderContractError` errors. Operational errors preserve the safe operation/run/dataset/status/code context and retryability; malformed provider data is rejected before crossing the outbound port.
- Added explicit, opt-in live configurations and commands: `npm run capture:contract` has a hard maximum of 10 places; `npm run test:e2e:live` has a separately enforced maximum of 20. Neither command is part of ordinary test, build, or CI scripts.
- Executed the single permitted contract-capture Actor run: `4u1dJaqJLfo8YDwSM`, purpose `contract-capture`, maximum requested places `10`, plan live-run count `1`. The run succeeded and its dataset was retrieved through the adapter in one bounded page containing 10 items. The checked-in fixture is sanitized and contains no provider token or captured business data.
- Added offline adapter parsing tests using only the sanitized fixture, including a typed malformed-item failure. The normal test suite made no Apify calls.
- Verified Discovery with lint, strict typecheck, ordinary tests (19 passing), build, and persistence integration tests (4 passing). Verified Qualification remains independent with lint, strict typecheck, tests, and build. Rebuilt Discovery's Docker image and confirmed `/health/live` and `/health/ready` return `status: ok`.
- Reviewed Steps 6-8 against the implemented ports, provider adapter, stored run references, quota reservation, and fixture. Step 6 can now persist the adapter run ID immediately after scope claim and import the already-normalized bounded pages. Step 7 can test the typed provider errors and fixture parser without live access. Step 8 can use the explicit, 20-place-capped live E2E command only after Step 6 completes. No pending-plan changes are required.

---

## Step 6 — Complete idempotent lead import and durable Discovery output

**Status:** Done

### Objective

Turn completed Apify datasets into persistent leads without ever treating the same provider identity as new twice.

### Observable result

A dataset can be imported, interrupted, re-read, and completed safely. Only genuinely new source identities create new durable Discovery outputs.

### Implementation

1. Implement the application use case that starts an Apify run for a claimed scope and immediately persists the provider run ID.
2. Implement the use case that revisits persisted runs and transitions them according to provider status.
3. When a run succeeds, persist the dataset reference required for import.
4. Import dataset items in bounded batches/pages.
5. Batch-upsert normalized leads by `(sourceKind, externalId)`.
6. Distinguish newly inserted leads from already known leads.
7. Persist actual provider-item consumption against the reserved daily quota according to the implemented reservation/accounting model, without allowing retries or concurrent workers to bypass the daily cap.
8. Persist import progress only after the corresponding batch has been durably processed.
9. Make re-reading the same dataset page after a crash harmless.
10. Create a durable provider-neutral output record only for a genuinely new lead.
11. Give the output record a deterministic/idempotent identity suitable for a later message publisher.
12. Do not wire a production broker in this plan.
13. After the final dataset page is durably imported, mark the scope Done.
14. Verify the next worker cycle automatically selects the next eligible configured scope.
15. Review the next two pending steps before marking this step Done.

### Verification

Simulate:

- duplicate provider items in one dataset;
- the same provider item appearing on a later run;
- process restart while the Actor is still running;
- restart after Actor success but before import;
- restart after one imported page before the next page;
- re-reading an already processed page;
- completing GB and automatically moving to the next configured scope;
- reaching the daily quota and resuming the same unfinished scope in the next UTC quota window.

Confirm that the same source identity creates at most one “new lead” output record.

### DoD

- Import is batch-oriented and restart-safe.
- Deduplication is deterministic.
- Repeated provider observations do not become new leads.
- Durable output exists for later Qualification delivery.
- Scope completion and next-scope progression work automatically.
- The next two pending steps have been reviewed.

### Done

- Extended `DiscoveryProgressService` into the persisted worker use case. It resumes an unlocked or stale active scope before claiming a new pending scope, reserves the configured provider-item cap before an Actor start, saves that reservation in the scope state, starts the Actor asynchronously, and immediately saves the returned provider run reference.
- Added atomic recovery claims for active `RUNNING` and `IMPORTING` scopes. Each successful state update clears its temporary worker claim; a crash-held claim becomes eligible for recovery after the bounded five-minute stale-claim interval.
- Completed provider lifecycle handling: pending/running Actor runs are revisited on later worker cycles, terminal provider states are persisted as failed scopes, and successful runs transition to import only when a dataset reference is present.
- Added bounded imports of 25 normalized candidates per worker cycle. Import progress records the next durable offset and actual imported-item count only after lead and output persistence. Re-reading an unrecorded page is harmless because lead identity and output identity are persistent and idempotent.
- Lead IDs and output IDs are deterministic hashes. A new `(sourceKind, externalId)` creates one generic lead and one pending provider-neutral discovery-output record; duplicate candidates in the same or later runs update the known lead but create no second output. No broker or Qualification transport was added.
- Persisted scope state now includes the reserved provider-item count, and the MongoDB state repository atomically claims recoverable active scopes while unsetting obsolete claim/progress fields on state transitions. MongoDB integration coverage now verifies active-scope claiming and idempotent discovery-output storage in addition to the existing source-identity, progress, and quota guarantees.
- Verified Discovery with lint, strict typecheck, ordinary offline tests (21 passing), persistence integration tests (6 passing), and build. Verified Qualification with lint, strict typecheck, tests, and build. No live Apify run was made during this step; the plan total remains one contract-capture run at a maximum of 10 places.
- Reviewed Steps 7-8. Step 7 can now exercise the new recoverable-active claim path, terminal provider handling, and persistence-output failure diagnostics with fakes/fixtures only. Step 8 has the necessary application path for the explicitly opt-in, 20-place-capped live smoke flow; deploying that build is intentionally deferred to that step to avoid starting a paid Actor outside the approved E2E action. No pending-plan changes are required.

---

## Step 7 — Verify failure diagnostics, recovery, and Discovery quality gates

**Status:** Done

### Objective

Prove that ordinary failures can be diagnosed from container logs and that restart/idempotency guarantees hold under realistic failure cases.

### Observable result

An operator can inspect logs and identify what failed, in which class/method, for which campaign/scope/run/input, and whether the operation can retry.

### Implementation

1. Add focused unit tests for domain state transitions and application orchestration; unit tests must have no live Apify path.
2. Add adapter tests using sanitized real Apify fixtures; adapter tests must have no live Apify path.
3. Add/review integration tests for MongoDB uniqueness, atomic claims, and daily provider-quota enforcement; integration tests must have no live Apify path.
4. Add restart-recovery tests for the scenarios defined in Step 6 without live Apify.
5. Cause controlled failures for at least:
   - invalid campaign config;
   - MongoDB unavailable;
   - invalid/unauthorized Apify token in a controlled test path;
   - provider terminal failure;
   - malformed provider dataset item;
   - persistence failure.
6. Confirm logs include the `../AGENTS.md` diagnostic context:
   - service;
   - class;
   - method;
   - operation;
   - correlation ID;
   - campaign ID;
   - scope ID;
   - provider run ID when available;
   - sanitized relevant input;
   - retryability;
   - original error;
   - stack trace.
7. Confirm secret redaction under failure conditions.
8. Verify the ordinary test command cannot perform paid network calls even though `APIFY_API_TOKEN` exists in the root environment.
9. Run Discovery lint, strict typecheck, tests, and build.
10. Run Qualification lint, strict typecheck, tests, and build to ensure Discovery work did not break the independent service.
11. Review the final pending step before marking this step Done.

### Verification

Run the repository's actual equivalents of:

```text
lint
typecheck
test
build
```

for both services.

Inspect representative structured error logs directly.

### DoD

- Failure logs are actionable rather than generic.
- Secrets are redacted.
- Unit, adapter, and integration tests are offline with respect to Apify.
- Restart/idempotency/quota tests pass.
- No forbidden TypeScript escape hatches were introduced.
- Both services pass their quality gates.
- The final pending step has been reviewed.

### Done

- Added `DiscoveryWorkError` with campaign, scope, provider-run, attempt, source-kind, and retryability context. The scheduler now retains the inbound correlation ID on failure and writes that context as structured JSON fields and safe replay input instead of producing an uncorrelated generic error record.
- Extended structured-log serialization and tests to prove that operation context is retained while nested secret fields are centrally redacted. A worker adapter test inspects the emitted JSON error record for campaign, scope, provider run, and retryability.
- Added offline controlled-failure coverage for invalid campaign configuration, MongoDB connection failure, an unauthorized/non-retryable provider failure, terminal provider status, malformed provider data, and a persistence failure during import. The MongoDB failure is mocked at the driver boundary; no provider network call is made.
- Kept and re-ran restart, idempotency, unique-index, active-claim, quota, and output tests. Normal Discovery tests contain no live Apify action; the only plan live run remains the earlier 10-place contract capture.
- Verified Discovery with lint, strict typecheck, ordinary tests (27 passing), persistence integration tests (6 passing), and build. Verified Qualification with lint, strict typecheck, tests, and build. `git diff --check` passed; the static TypeScript scan found only the existing valid `dotenv` import alias.
- Reviewed Step 8 against the completed code. The final smoke flow can rebuild/start Discovery only as part of its explicitly opt-in, 20-place-capped live E2E action, then observe persisted restart recovery and independent Qualification availability. No pending-plan changes are required.

---

## Step 8 — Run the end-to-end Discovery smoke flow and close the plan

**Status:** Done

### Objective

Validate the completed MVP as one coherent system and record the actual implementation outcome.

### Observable result

A small configured Discovery scope is processed from config through Apify, MongoDB, lead persistence, durable output, and scope completion, while Qualification remains an independently healthy NestJS service.

### Implementation

1. Start the required local infrastructure using the intended root environment convention.
2. Start both microservices independently.
3. Run the dedicated opt-in live E2E path rather than a full-country paid crawl. Each live E2E Actor run must be hard-limited to at most 20 places.
4. During this plan, execute no more than four live E2E Actor runs, and keep total live Actor runs/places within the plan-level allowance defined above.
5. Verify the complete path:
   - configuration loaded;
   - scope claimed;
   - Apify run started;
   - run ID persisted;
   - provider completion detected;
   - dataset read;
   - leads normalized and persisted;
   - duplicate source identity rejected as new;
   - durable output created only for new leads;
   - scope marked Done;
   - worker becomes idle or chooses the next configured scope.
6. Restart Discovery during a controlled smoke scenario and verify it resumes from persisted state.
7. Confirm stopping Qualification does not break Discovery.
8. Confirm stopping and restarting Discovery does not cause a known source identity to be emitted again as new.
9. Update this step's Done section with:
   - actual source/config structure;
   - major implementation decisions;
   - commands run;
   - tests performed;
   - Apify limitations discovered;
   - any intentionally deferred items.
10. Record the number of real Actor runs started and their configured maximum-place limits in the execution record.
11. Confirm no additional plan steps are required. If additional required work is discovered, insert it using the sequential integer renumbering rules from `../AGENTS.md` before closing the plan.

### Verification

- Both services start from the intended repository setup.
- Discovery completes the small paid live E2E run successfully without exceeding the 20-place per-run safety cap.
- The execution record confirms the total plan live-call allowance was not exceeded.
- Restart recovery is observed in practice or in an equivalent controlled integration test.
- MongoDB contains only one lead identity per `(sourceKind, externalId)`.
- Only genuinely new leads have durable output records.
- Logs are sufficient to trace the smoke flow and diagnose a controlled failure.

### DoD

- The Discovery MVP works end to end.
- Qualification remains independently runnable and healthy.
- All required quality gates pass.
- The root `.env` convention works for the intended local/Docker operation.
- The production daily provider-item cap and per-run cap are enforced.
- Live development/test calls stayed within the plan allowance.
- Known limitations and deferred work are documented.
- No unplanned required work remains.
- The plan has a complete execution record.

### Done

- Added the explicit `npm run test:e2e:live` command. It reads the dedicated E2E configuration, creates the isolated campaign `independent-accommodation-europe-live-e2e`, enforces a 20-item daily and per-run limit inside the application configuration, uses the real MongoDB adapters and Apify adapter, and never runs as part of ordinary tests or builds.
- Executed one live E2E Actor run, `4fWnnAzl8r4obWyqU`, with purpose `e2e`, current plan run count `2`, and a maximum of `20` requested places. It completed successfully. The persisted E2E scope is `done`, with `importedItemCount: 20` and `nextItemOffset: 20`; MongoDB contains 20 E2E output records with 20 distinct lead IDs.
- The live command reconstructed `DiscoveryProgressService` after the Actor run had started before continuing its poll/import loop, demonstrating persisted run/progress recovery without relying on process memory. It used the same persisted scope/run state through completion.
- Rebuilt both Compose images and confirmed Discovery and Qualification readiness. Stopped Qualification and confirmed Discovery remained ready; restarted Qualification and confirmed its readiness. Discovery was then stopped before its ordinary minute scheduler could start a non-E2E production-campaign Actor run. Qualification remains running and healthy.
- Completed final quality gates: Discovery lint, strict typecheck, ordinary tests (27 passing), persistence integration tests (6 passing), and build; Qualification lint, strict typecheck, tests, and build; `git diff --check` passed.
- Live-call execution record for the whole plan: contract capture `1 x 10` places and E2E `1 x 20` places, for `2` Actor runs and `30` requested places total. This remains within the maximum allowance of 5 runs / 100 requested places. No additional plan steps are required.

---

# Plan completion criteria

This plan is complete only when all steps are `Done` and:

- `discovery` and `qualification` are independently runnable NestJS services;
- both follow the Hexagonal Architecture rules from `../AGENTS.md`;
- the repository uses one root `.env` and `.env.example`;
- the root `../.gitignore` correctly handles both nested microservices;
- each service owns a separate logical MongoDB database;
- Qualification cannot directly access Discovery persistence;
- Discovery is generic and configuration-driven rather than hotel-specific;
- Discovery uses `compass/crawler-google-places` through an isolated Apify adapter;
- the Apify run ID and import state survive service/host restart;
- configured scopes advance automatically without human intervention;
- Discovery enforces an initial 500-provider-items/day production quota and 100-provider-items/run cap through validated configuration;
- exhausting the daily quota pauses paid work and resumes automatically in the next quota window;
- unit, adapter, and normal integration tests do not call real Apify;
- contract capture is limited to one live run of at most 10 places;
- opt-in live E2E is limited to at most 20 places per run and the full plan execution remains within 5 live Actor runs / 100 requested places;
- source identity is uniquely enforced by `(sourceKind, externalId)`;
- the same source identity cannot be emitted twice as a newly discovered lead;
- Discovery creates durable provider-neutral output records suitable for later delivery to Qualification;
- expensive provider enrichment is not enabled;
- representative failures are diagnosable from structured container logs;
- strict typecheck passes;
- lint passes;
- tests pass;
- builds pass;
- no forbidden TypeScript escape hatches were introduced;
- Qualification business logic and production inter-service transport remain explicitly deferred to later plans.
