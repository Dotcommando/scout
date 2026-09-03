# AGENTS.md

## Purpose

This repository implements a generic, configuration-driven lead acquisition
platform.

The first two independently deployable microservices are:

1. `discovery` — finds candidate leads from configured external sources.
2. `qualification` — decides whether discovered leads are worth passing to
   downstream analysis.

The platform must not be coupled to hotels. A campaign may search for hotels
today, cinemas tomorrow, and another business category later without changing
the core application code.

Business vertical differences belong in configuration and, only when truly
necessary, in narrowly scoped pluggable domain policies. Do not introduce
classes, identifiers, database fields, or service names such as `Hotel`,
`HotelId`, or `HotelDiscovery` into generic platform code.

The generic domain term is `Lead`.

---

## Core Product Boundaries

### Discovery

`discovery` answers:

> Which candidate leads exist within the configured search scope?

Responsibilities:

- read discovery campaign configuration;
- process configured scopes in deterministic priority order;
- call the configured discovery source through an outbound port;
- normalize provider-specific data into the internal lead representation;
- persist enough state to resume safely after process or machine restarts;
- prevent the same source entity from being emitted repeatedly;
- publish newly discovered leads through an explicit outbound port;
- continue automatically to the next pending scope when the current scope is
  exhausted;
- optionally revisit completed scopes according to configured rescan policy.

Discovery must not:

- decide whether a lead is commercially attractive;
- perform expensive website analysis;
- inspect OTA presence;
- search for people or contacts;
- generate pitches;
- make sales decisions;
- contain vertical-specific hotel logic;
- perform probabilistic entity resolution unless a future task explicitly
  introduces it.

### Qualification

`qualification` answers:

> Is this discovered lead worth spending more resources on for this campaign?

Responsibilities:

- consume discovered leads through an inbound port;
- load the applicable qualification configuration;
- evaluate deterministic qualification rules;
- record the qualification result and reasons;
- make processing idempotent;
- emit qualified leads through an explicit outbound port for the next
  independent system;
- keep rejected and indeterminate results auditable.

Qualification must not:

- discover new leads;
- crawl or deeply analyze websites unless a future qualification rule
  explicitly requires a cheap bounded check;
- inspect OTA presence as a sales-opportunity analysis;
- search for people or contacts;
- generate previews or pitches;
- perform downstream opportunity analysis.

The next system after Qualification is expected to be an independent
Opportunity Analysis service. It is outside the scope of these first two
microservices.

---

## Service Independence

`discovery` and `qualification` are independent runtime units.

Rules:

- each service must be independently buildable, testable, runnable, stoppable,
  restartable, and deployable;
- one service must not import application or domain code from the other;
- one service must not call another service's classes or repositories directly;
- one service must not read or write another service's persistence tables or
  collections directly;
- cross-service communication must happen through explicit inbound/outbound
  ports and transport contracts;
- transport technology must remain an adapter concern;
- message delivery must be treated as at-least-once unless the chosen transport
  provides stronger guarantees;
- consumers must therefore be idempotent;
- a temporary outage of Qualification must not corrupt Discovery state;
- stopping the whole computer must not cause a completed lead or completed
  scope to be processed as new after restart.

Shared code is allowed only when it represents a genuinely stable shared
technical contract. Do not create a generic `shared`, `common`, or `utils`
dumping ground.

---

## Recommended Repository Layout

Each microservice follows Hexagonal Architecture independently.

```txt
apps/
  discovery/
    src/
      domain/
      app/
      ports/
        inbound/
        outbound/
      adapters/
        inbound/
        outbound/
    test/

  qualification/
    src/
      domain/
      app/
      ports/
        inbound/
        outbound/
      adapters/
        inbound/
        outbound/
    test/

config/
  discovery/
  qualification/

plans/

packages/
  contracts/
```

`packages/contracts` is optional. Use it only for explicit cross-service
transport contracts that are genuinely shared. It must not become a place for
shared domain entities or application services.

If the repository evolves away from this exact physical layout, preserve the
same dependency boundaries.

---

## Project Architecture

This project strictly follows Hexagonal Architecture.

```txt
src/
  domain/
  app/
  ports/
    inbound/
    outbound/
  adapters/
    inbound/
    outbound/
```

Rules:

- `src/domain` contains domain entities, value objects, domain services, domain
  events, and business rules. It must not depend on frameworks or
  infrastructure.
- `src/app` contains application use cases, application services,
  orchestration, and application DTOs.
- `src/ports` contains contracts only.
- `src/adapters` contains implementations of those contracts.
- `src/ports/inbound` contains inbound port interfaces.
- `src/ports/outbound` contains outbound port interfaces.
- `src/adapters/inbound` contains driving adapters such as REST controllers,
  message consumers, CLI commands, and schedulers.
- `src/adapters/outbound` contains driven adapters such as MongoDB
  repositories, HTTP clients, message producers, object storage adapters,
  discovery-provider adapters, and other infrastructure integrations.
- external APIs and provider-specific DTOs must never leak outside outbound
  adapters;
- normalize external data before passing it into the application layer;
- dependencies must always point inward;
- adapters depend on ports and application logic;
- application logic depends on ports and domain;
- domain depends on nothing outside itself;
- NestJS decorators and NestJS framework types must not appear in the domain;
- provider SDK types must not appear in ports, application services, or domain
  entities.

---

## Domain Neutrality

Core code must remain independent of the current sales vertical.

Good names:

```txt
Lead
LeadId
Campaign
DiscoveryScope
DiscoverySource
DiscoveryRun
QualificationProfile
QualificationDecision
QualificationReason
```

Avoid names such as:

```txt
Hotel
HotelId
HotelCampaign
HotelDiscoveryService
CinemaDiscoveryService
```

A vertical-specific term may appear in configuration values, test fixtures, or
a deliberately isolated policy implementation when the configuration model
alone is insufficient.

The first implementation must prefer configuration over new vertical-specific
code.

---

## Discovery Identity And Deduplication

Deduplication must be deliberately simple.

The default design is one authoritative discovery source per campaign. Do not
add a second discovery source merely to improve recall.

For a provider that exposes a stable external identifier, the source identity
must be represented by:

```txt
(source kind, external id)
```

This pair must be protected by a database uniqueness constraint.

Do not use:

- fuzzy name matching;
- LLM-based identity matching;
- address similarity scores;
- arbitrary confidence percentages;
- probabilistic deduplication;
- hidden heuristics that cannot be explained deterministically.

If a second discovery source is introduced later, it requires an explicit plan
covering identity semantics and cross-source deduplication before
implementation begins.

A duplicate observation from the same source may update freshness or mutable
provider data, but it must not cause the lead to be emitted downstream again as
a newly discovered lead.

Deduplication correctness must be enforced by persistent storage constraints,
not only by in-memory checks.

---

## Discovery Scope Progression

Discovery must not require a human to choose the next country or scope.

A discovery campaign contains an ordered set of scopes. A scope may represent a
country, region, geographic cell, query partition, or another provider-specific
search partition.

The order is configuration-driven.

Typical lifecycle:

```txt
PENDING
  -> RUNNING
  -> IMPORTING
  -> DONE
```

A failed scope may enter an explicit failure state according to the service's
error model.

Rules:

- scope state is persisted;
- the current provider run identifier or equivalent resumable reference is
  persisted when available;
- progress required for restart recovery is persisted;
- completion is persisted before moving to the next scope;
- after a scope reaches `DONE`, Discovery selects the next eligible scope
  automatically;
- after all currently eligible scopes are complete, Discovery becomes idle
  rather than terminating incorrectly;
- a configured rescan policy may make a completed scope eligible again later;
- rescanning an old scope must discover only genuinely new source identities as
  new leads;
- process memory must never be the only source of truth for run progress.

The system must survive:

- Docker container restart;
- service process crash;
- host reboot;
- temporary network failure;
- repeated delivery of the same provider result;
- repeated delivery of the same inter-service message.

---

## Configuration-Driven Behaviour

Business targeting and runtime behaviour must be controlled through validated
configuration.

Examples of configuration-owned concerns:

- campaign identifier;
- source kind;
- source enabled state;
- search queries;
- geographic scopes;
- scope priorities;
- category filters;
- rescan policy;
- qualification profile;
- deterministic qualification rules;
- known exclusions;
- minimum or maximum thresholds;
- downstream output settings that are not secrets.

Environment variables are for deployment-specific values such as:

- secrets;
- tokens;
- database URLs;
- broker URLs;
- ports;
- runtime environment;
- infrastructure credentials.

Do not encode campaign business rules in environment variables.

Configuration must be validated at startup before work begins. Invalid
configuration must fail fast with a precise error containing the configuration
file, field path, invalid value when safe, and validation reason.

A worker must not silently fall back to a different campaign, source, scope, or
qualification profile when configuration is invalid.

Persist the relevant configuration version, revision, or stable content hash
with processing records when needed for reproducibility.

---

## Constants And Enums

When a field has a closed set of string values, define an enum instead
of an inline string-literal union. Architecture examples may show raw
strings for readability; implementation code must use the corresponding
enum.

Example:

```typescript
export const DEFAULT_SOURCE_ENABLED = true;

export enum CONTENT_SOURCE_KIND {
  REDDIT = 'reddit',
  HACKER_NEWS = 'hacker-news',
}

export const CONTENT_SOURCE_KIND_ARRAY = Object.values(CONTENT_SOURCE_KIND);
```

Pay attention to how we export the array of enum values.

Constants and enums must belong to the narrowest module that owns their
semantics. Do not create global constants or enum collections for unrelated
concepts.

---

## TypeScript And Coding Rules

TypeScript must run in strict mode.

New code must not use:

- `any`;
- `as`;
- the `object` type;
- double assertions such as `as unknown as`;
- `@ts-ignore`;
- `@ts-nocheck`.

Prefer:

- precise narrowing;
- discriminated unions;
- enums;
- generics;
- explicit interfaces;
- exhaustive control flow;
- validated parsing at infrastructure boundaries.

Prefer interfaces over type aliases for object shapes.

For newly introduced internal object-shape interfaces, use the `I` prefix.

Do not rename existing public contracts or ports without an explicit task.

When a field has a closed set of string values, use an enum instead of a
string-literal union.

Do not bypass type-system errors merely to make a build pass. Fix the model,
parsing, narrowing, or API boundary that caused the error.

Use the repo's existing patterns and narrowest reasonable module ownership.
Avoid unrelated refactors.

Method names must describe what the method does, not the business pipeline or
workflow in which it participates.

Prefer:

```txt
saveLead()
findPendingScopes()
publishLead()
evaluateRules()
```

Avoid:

```txt
runDiscoveryPipeline()
doNextStep()
processWorkflowThing()
```

Use structured APIs and parsers instead of ad hoc string manipulation when
reasonable.

Add abstractions only when they remove real complexity, reduce meaningful
duplication, or match an established local pattern.

If required context is not available in the workspace or current conversation,
ask for the file or details before guessing. If the file exists in the
workspace, read it directly.

When building objects with optional properties, prefer conditional object
spread over repeatedly mutating an initially empty object. Preserve semantics
for valid falsy values.

Prefer concise returns and ternaries when they improve readability.

Do not make cosmetic edits or reformat existing code merely to match a
different personal style.

Do not remove user-written comments.

Do not add new comments unless they provide essential value.

Do not list unchanged files in implementation summaries.

CRUD-style services should be batch-oriented by default.

Default to ASCII in files unless non-ASCII is required.

Do not use destructive git commands unless the user explicitly requests them.

---

## Error Handling

Errors must be explicit and diagnosable.

Do not:

- swallow exceptions;
- catch an error only to return `undefined`;
- convert infrastructure failures into ordinary negative business decisions;
- log an error and then pretend the operation succeeded;
- retry every failure indiscriminately.

Distinguish at minimum between:

- domain/business rejection;
- invalid input or configuration;
- transient infrastructure failure;
- permanent provider failure;
- persistence failure;
- transport failure;
- internal programming error.

Retry policy belongs to the application/infrastructure boundary appropriate to
the failure. Retried operations must be idempotent.

When wrapping an error, preserve the original error as the cause when the
runtime supports it.

---

## Logging And Diagnosability

The system must be operable from Docker logs.

When something fails, an operator must be able to enter the container or run
`docker logs` and determine:

- which microservice failed;
- which class or service failed;
- which method failed;
- which logical operation was being performed;
- which campaign was involved;
- which discovery scope was involved when applicable;
- which lead was involved when applicable;
- which provider or adapter was involved;
- which attempt failed;
- what sanitized input was passed to the failing operation;
- what the external dependency returned when relevant;
- whether the failure is retryable;
- the original error message and stack trace;
- the correlation identifier needed to follow the operation across services.

Do not rely on vague messages such as:

```txt
Failed to process lead.
Something went wrong.
Provider request failed.
```

Logs must be structured, machine-readable, and written to stdout/stderr.
JSON logging is preferred for runtime logs.

Every error log must include sufficient structured context. A typical error
record should conceptually contain:

```json
{
  "level": "error",
  "service": "discovery",
  "class": "DiscoverScopeService",
  "method": "discoverScope",
  "operation": "discover-scope",
  "correlationId": "01J...",
  "campaignId": "independent-hotels-europe",
  "scopeId": "GB",
  "sourceKind": "google-maps",
  "attempt": 2,
  "input": {
    "scopeId": "GB",
    "query": "hotel"
  },
  "retryable": true,
  "error": {
    "name": "ProviderRequestError",
    "message": "Request timed out",
    "stack": "..."
  }
}
```

The exact logger implementation may differ, but the diagnostic information must
not.

### Logging Rules

- generate or accept a correlation ID at every inbound boundary;
- propagate the correlation ID through application calls and outbound messages;
- include message ID or event ID for message-driven operations;
- include provider request/run ID when available;
- include `leadId` only after an internal lead identity exists;
- include duration for external calls and major application operations;
- log retries with attempt number and retry reason;
- log terminal failures at error level;
- log recoverable retries at warning level unless the local logging convention
  establishes another clear rule;
- log successful major state transitions at info level;
- avoid noisy per-line debug logging in normal production operation;
- debug logs may contain additional diagnostic context but must still be
  structured.

### Input Logging

On failures, log sanitized input sufficient to reproduce the failing call.

Do not log:

- API tokens;
- passwords;
- authorization headers;
- cookies;
- private keys;
- full environment-variable dumps;
- secrets embedded in URLs;
- unnecessarily large raw provider payloads.

Implement centralized redaction for known secret fields.

If an input payload is too large, log stable identifiers plus a bounded,
sanitized representation instead of silently omitting all input context.

### Provider Failures

Outbound adapters must preserve useful provider context when safe, including:

- provider name;
- endpoint or operation name;
- HTTP status;
- provider error code;
- provider run ID;
- rate-limit information when available;
- retry-after information when available;
- bounded response body or parsed provider error.

Provider-specific error DTOs must remain inside the outbound adapter. Convert
them into internal typed errors before they cross the adapter boundary.

### Persistence Failures

Persistence errors must identify:

- repository;
- repository method;
- entity or aggregate identifier when available;
- uniqueness conflict versus infrastructure failure;
- database operation category;
- retryability.

A uniqueness conflict used for idempotency is an expected technical condition
and must not be logged as an unexplained fatal error.

---

## Observability And Runtime Operations

Each service must expose separate liveness and readiness checks.

Liveness answers whether the process is functioning.

Readiness answers whether the service can currently perform its work, including
required infrastructure dependencies.

Graceful shutdown is mandatory:

- stop accepting new work;
- finish or safely abandon the current unit according to its idempotency model;
- close broker consumers/producers;
- close database connections;
- allow the persisted state to make restart recovery deterministic.

Handle `SIGTERM` correctly for Docker shutdown.

Do not require an interactive operator to repair ordinary crash recovery.

---

## Idempotency

Idempotency is a system requirement, not an optimization.

For every side-effecting use case, explicitly identify its idempotency key.

Examples:

```txt
Discovery source identity:
  sourceKind + externalId

Campaign membership:
  campaignId + leadId

Qualification execution:
  campaignId + leadId + qualificationProfileVersion

Published message:
  deterministic event/message identity
```

The exact schema may evolve, but uniqueness must be enforceable in persistent
storage whenever practical.

Never depend only on:

- an in-memory `Set`;
- a process-local cache;
- a "currently processing" boolean without durable ownership;
- optimistic assumptions that a message will be delivered only once.

---

## Qualification Decisions

Qualification must produce an explicit decision.

Use an enum for the closed set of decisions.

The model should support at least the semantics of:

```txt
QUALIFIED
REJECTED
INDETERMINATE
```

Do not use floating-point confidence scores as a substitute for a deterministic
decision unless a future task explicitly introduces such a model.

Every non-trivial qualification decision must be auditable through structured
reason codes.

Reason codes must be machine-readable enums. Human-readable descriptions may be
derived from them.

Changing qualification rules must not require rediscovering the lead.

A new qualification profile version may re-evaluate already discovered leads.

---

## Messaging And Contracts

Cross-service messages are public contracts between independently deployed
services.

Rules:

- define explicit message schemas;
- include a schema version;
- include a message/event ID;
- include a correlation ID;
- include the event creation timestamp;
- use enums for closed string sets;
- validate every inbound message before it reaches application logic;
- reject malformed messages explicitly;
- make consumers idempotent;
- do not expose provider-specific DTOs in messages;
- do not expose database persistence documents in messages;
- do not serialize NestJS classes as transport contracts by accident.

A service must be able to change its internal persistence model without forcing
the other service to change when the public message contract has not changed.

---

## Persistence

Repository ports expose domain/application needs, not database primitives.

Avoid ports such as:

```txt
getCollection()
runAggregationPipeline()
findMongoDocument()
```

Prefer intent-oriented repository methods such as:

```txt
findPendingScopes()
claimScope()
saveDiscoveryProgress()
findBySourceIdentity()
saveLead()
recordQualificationDecision()
```

MongoDB-specific types must remain in MongoDB adapters.

Indexes that enforce correctness are part of the implementation, not optional
performance tuning. Add and test required uniqueness indexes.

Database writes used in restart recovery must be ordered so that a crash cannot
make completed work appear new.

---

## Environment Variables

This repository uses one root environment file:

```txt
/.env
/.env.example
```

Do not create or keep independent `discovery/.env` or `qualification/.env`
files unless a future explicit plan changes this repository convention.

The root environment file is an operator/development convenience. It does not
change service ownership:

- each service must validate and consume only the variables it owns;
- Docker Compose may use the root `.env` for interpolation while passing only
  the required variables into each container;
- a secret used only by Discovery, such as `APIFY_API_TOKEN`, must not be
  injected into Qualification merely because both services share the root
  environment source.

Whenever adding, removing, or changing environment variables:

- update both root `.env` and root `.env.example`;
- never leave `.env.example` outdated;
- use realistic placeholder values.

Conventions:

- ports must have exactly the same values in `.env.example` as in `.env`;
- passwords must use the placeholder `password`;
- secrets, API secrets, signing keys, and tokens must use the placeholder
  `secret`;
- URLs should point to localhost unless a different example is required.

Environment parsing must be validated at startup.

Do not read `process.env` throughout application code. Centralize environment
loading in the appropriate inbound/bootstrap infrastructure layer and pass
typed configuration inward through explicit contracts.

---

## Testing

Tests must respect architecture boundaries.

### Domain Tests

Test:

- value objects;
- domain decisions;
- qualification rules;
- state-transition invariants;
- idempotency-related business semantics.

Domain tests must not boot NestJS or access infrastructure.

### Application Tests

Test use cases with in-memory or explicit fake port implementations.

Cover:

- normal execution;
- duplicate delivery;
- restart/retry semantics where relevant;
- transient outbound failure;
- permanent outbound failure;
- invalid input;
- already-completed work.

### Adapter Tests

Test provider normalization and persistence adapters against realistic provider
fixtures and database behaviour.

External provider fixtures must remain adapter-owned.

### Integration Tests

Critical persistence guarantees require integration tests, especially:

- uniqueness constraints;
- atomic claims;
- duplicate inserts;
- restart recovery;
- concurrent workers claiming the same work;
- idempotent message consumption.

### End-to-End Tests

Each microservice must have a minimal end-to-end path proving that its inbound
adapter, application use case, outbound port implementation, persistence, and
logging/bootstrap wiring work together.

Tests must not depend on live third-party APIs unless the active plan explicitly
requires such a test.

When the active plan permits real provider calls:

- the plan's live-call limits are hard upper bounds, not suggestions;
- ordinary unit, adapter, integration, build, and default test commands remain
  offline unless the active plan explicitly says otherwise;
- live provider tests must use an explicit opt-in command or flag;
- fixtures captured from real providers must be sanitized before being stored;
- a stricter provider budget in the active plan takes precedence over more
  permissive general testing guidance in this file.

---

## Quality Gates

Before marking an implementation plan complete, run the repository's applicable
quality checks.

At minimum the project should provide commands equivalent to:

```txt
lint
typecheck
test
build
```

Do not declare a step complete when its required verification is failing.

Do not weaken lint, compiler, or test settings merely to make a change pass.

---

## Plan-Driven Development

Non-trivial repository changes must be executed from a written plan.

Plans live in:

```txt
plans/
```

Use one Markdown file per task.

A plan is an execution document, not a vague checklist written once and then
ignored.

### Active Plan

The currently active implementation plan is identified by:

```txt
plans/ACTIVE_PLAN.md
```

`ACTIVE_PLAN.md` must contain the filename of the active plan, not a copy of the
plan itself.

Example:

```txt
DISCOVERY_BOOTSTRAP_AND_MVP.md
```

Rules:

- work on only one active plan unless the user explicitly asks otherwise;
- before non-trivial implementation begins, `plans/ACTIVE_PLAN.md` must exist
  and point to an existing plan file under `plans/`;
- if `ACTIVE_PLAN.md` is missing, stale, or points to a missing plan, fix the
  active-plan pointer before editing production code;
- when starting a different plan, update `ACTIVE_PLAN.md` before implementation
  begins;
- do not silently switch plans during implementation;
- if a user request changes the scope of the current task, update the active
  plan first or create/activate a new plan when the work is genuinely a
  separate task;
- leaving a completed plan referenced by `ACTIVE_PLAN.md` is acceptable until
  another plan is activated, but no further implementation may be appended to
  it as though it were still pending without first updating the plan
  explicitly.

For the current Discovery MVP work, the intended active-plan pointer is:

```txt
DISCOVERY_BOOTSTRAP_AND_MVP.md
```

### Before Implementation

Before editing production code for a non-trivial task:

1. read the nearest `AGENTS.md`;
2. read `plans/ACTIVE_PLAN.md`;
3. read the active plan named by that file;
4. inspect the relevant existing code, configuration, documentation, and
   repository structure;
5. compare the plan's assumptions with the actual repository before trusting
   paths, filenames, dependencies, or infrastructure assumptions;
6. identify the first non-`Done` plan step;
7. confirm that step still matches the actual repository state;
8. update pending plan content if reality differs;
9. mark the step `In Progress`;
10. only then edit implementation files.

Do not implement work outside the active plan unless the user explicitly asks
for it.

### Plan Structure

Plans should use the same execution-oriented structure as the current Discovery
plan.

A plan normally contains:

```txt
# <Plan name>

## Goal

## Current Context / Context
## Target Structure / Direction
## Constraints
## Non-Goals

# Plan steps

## Step 1 — <Meaningful vertical increment>

**Status:** Pending

### Objective

### Observable result

### Implementation

### Verification

### DoD

# Plan completion criteria
```

Optional context sections may be omitted or added when they materially improve
execution.

Every implementation step must use one of these statuses:

```txt
Pending
In Progress
Done
```

A completed step must additionally contain:

```txt
### Done
```

The `Done` section records what was actually implemented and verified. It is a
historical execution record, not a restatement of the original intention.

Do not mark a step `Done` before:

- its implementation is complete;
- applicable verification has run;
- its `DoD` is satisfied;
- its `Done` section has been written.

### Plan Steps

Plan steps must:

- use sequential positive integer numbers;
- be expressed as `## Step N — <name>`;
- represent coherent, reviewable increments rather than tiny mechanical edits;
- be ordered by execution dependency;
- describe a concrete objective and observable result;
- include implementation guidance;
- include explicit verification;
- include a concrete `DoD`;
- avoid combining unrelated work into one step.

Prefer a small number of meaningful vertical steps over dozens of tiny
implementation instructions.

Avoid making every class, interface, file, or test its own top-level plan step.

### Validation-First Execution

For each plan step:

1. define or confirm the observable result;
2. define how that result will be verified;
3. add automated tests when the step contains meaningful logic or persistence
   behavior that can regress;
4. implement the smallest complete solution for the step;
5. run the applicable lint, typecheck, tests, build, integration checks, or
   controlled live checks described by the plan;
6. update documentation/configuration contracts affected by the change;
7. verify every applicable `DoD` item;
8. write the step's `Done` section;
9. change the step status to `Done`;
10. review the next three non-completed steps against the actual repository
    state before moving on.

Do not add meaningless tests solely to increase coverage.

If a required verification cannot be run, the step remains incomplete unless
the active plan explicitly defines an acceptable alternative.

### Updating A Plan During Execution

Plans are expected to change when implementation reveals new required work.

Do not silently perform unplanned work.

When new required work is discovered:

1. update the active plan first;
2. insert the new step at the correct execution position;
3. use a normal integer step number;
4. renumber every following step as necessary;
5. update references elsewhere in the plan if they mention affected step
   numbers;
6. review the next three non-completed steps after the change;
7. continue execution from the updated plan.

Never use fractional, alphabetic, or hierarchical step numbers.

Forbidden:

```txt
18.1
18a
18b
18-extra
```

Required behaviour:

If step `18` is already complete and a newly discovered task must be performed
before the old step `19`, the new task becomes step `19`.

The old step `19` becomes step `20`, the old step `20` becomes step `21`, and
so on.

Example before:

```txt
17. Complete repository integration.      Done
18. Add application orchestration.        Done
19. Add message publishing.               Pending
20. Add end-to-end tests.                 Pending
```

A new required step is discovered after completing step `18`.

Correct update:

```txt
17. Complete repository integration.      Done
18. Add application orchestration.        Done
19. Add retry classification.             Pending
20. Add message publishing.               Pending
21. Add end-to-end tests.                 Pending
```

Incorrect update:

```txt
18. Add application orchestration.        Done
18.1 Add retry classification.            Pending
19. Add message publishing.               Pending
```

Sequential integer numbering is mandatory even when later steps have already
been written.

### Executing A Plan

While working:

- re-read the active plan before continuing after a context/session break;
- execute steps in order unless the plan explicitly documents why a different
  order is safe;
- keep the plan synchronized with actual work;
- mark the current step `In Progress` before implementation;
- mark a step complete only after its implementation and required verification
  are complete;
- if verification fails, the step remains `In Progress` or returns to
  `Pending`, depending on whether implementation work has begun;
- if a step becomes unnecessary, record that explicitly rather than silently
  deleting completed history;
- if reality differs from the plan, update pending steps before continuing;
- do not treat the original plan as immutable when new facts require a change;
- do not mark future steps complete based on assumptions;
- do not collapse multiple unfinished steps into a single retrospective
  `Done` entry;
- do not silently perform work that belongs to a later plan step.

### Step Continuity

Completing a plan step does not require user approval to begin the next one.
After a step satisfies its verification and DoD, record its `Done` section,
commit and push the completed step, then immediately review and mark the next
pending step `In Progress`. Continue this sequence until the plan is complete.

Pause for user input only when a decision, authority, credential, external
coordination, or material scope choice is genuinely required to proceed
safely. Do not pause merely to report a completed step, request permission to
continue, or wait for confirmation between ordinary plan steps. If no such
decision is required, plans should be executed to completion in the same
continuous work stream.

### Completed Steps And History

Completed steps form an execution history.

Do not rewrite a completed step to pretend the work originally had a different
scope.

Minor wording corrections are acceptable when they do not alter the historical
meaning.

If additional work becomes necessary after a completed step, add a new
sequential step using the renumbering rule above.

The `Done` section may be appended or corrected to accurately record actual
verification, but do not erase meaningful historical information.

### Plan-Specific Constraints

The active plan may impose stricter limits than this file, including:

- external-provider spending limits;
- maximum live API calls;
- test-network restrictions;
- rollout limits;
- narrower service scope;
- stronger verification requirements.

Treat those stricter plan constraints as mandatory.

A plan must not silently weaken repository-wide architecture, typing, security,
idempotency, or logging rules from `AGENTS.md`. If a task genuinely requires a
repository rule to change, update `AGENTS.md` explicitly as part of the
approved work.

This rule is important for `DISCOVERY_BOOTSTRAP_AND_MVP.md`: its Apify daily
provider-item limits, per-run limits, contract-capture allowance, and live E2E
allowance are hard caps for execution of that plan.

### Completion

A plan is complete only when:

- every required step is `Done`;
- every completed step contains its verified `Done` record;
- applicable tests pass;
- lint passes;
- type checking passes;
- the build passes;
- required configuration examples are updated;
- required documentation is updated;
- no known plan deviation remains undocumented;
- the plan's completion criteria are satisfied.

At the end of the final step:

1. record the actual implementation and verification in its `Done` section;
2. record any intentionally deferred work and known limitations;
3. confirm whether additional required work exists;
4. if new required work exists, add it using normal sequential integer
   numbering before declaring the plan complete;
5. otherwise update the root `ACTUAL_STATE.md` with the verified post-plan
   state before declaring the plan complete; it must describe each deployed
   microservice, its inputs, outputs, and communication paths, and must not
   present planned work as implemented;
6. leave the completed plan intact as the historical execution record.


---

## Scheduling And Workers

Schedulers are inbound adapters.

Do not place business logic directly in cron handlers, interval callbacks, or
NestJS scheduler decorators.

A scheduler may:

1. trigger an inbound port;
2. supply the current time or trigger metadata;
3. log trigger context.

Application logic decides what eligible work exists.

Where continuous work is appropriate, prefer a restart-safe worker model over
encoding business progression into a fragile cron sequence.

The worker must derive the next unit of work from persisted state.

---

## External Providers

Every discovery provider is an outbound adapter behind a provider-neutral port.

Provider-specific concerns belong inside the adapter, including:

- request DTOs;
- response DTOs;
- pagination;
- provider run IDs;
- rate limits;
- provider status mapping;
- retry headers;
- provider-specific category names;
- raw error formats.

The application layer may understand provider-neutral concepts such as:

```txt
source identity
search scope
normalized lead
provider run reference
continuation cursor
```

It must not depend on an Apify Actor input schema, Google Maps DTO, or another
provider SDK structure.

Do not add multiple discovery providers to the same campaign without an
explicit requirement and deduplication plan.

---

## Cost Control

Discovery and Qualification are intentionally cheap stages.

Discovery should collect only information needed to establish identity,
basic metadata, and support cheap qualification.

Qualification should avoid expensive enrichment.

Do not download large review sets, screenshots, full websites, extensive
social profiles, or unrelated provider datasets merely because they are
available.

Expensive analysis belongs downstream after a lead has qualified.

A change that materially increases per-lead external cost must be explicit in
the implementation plan.

If the active plan defines provider quotas, per-run caps, live-test allowances,
or other spending controls, treat them as hard limits. Do not exceed them for
convenience, retries, contract exploration, or additional test coverage.

---

## Security

Never commit:

- API tokens;
- credentials;
- private keys;
- production connection strings;
- copied authorization headers;
- secrets in test fixtures.

Treat third-party provider data as untrusted input.

Validate data at adapter boundaries.

Do not interpolate untrusted values into shell commands.

Do not log secrets.

---

## Documentation And Summaries

Update documentation when a change modifies:

- runtime setup;
- configuration;
- environment variables;
- message contracts;
- public ports;
- operational behaviour;
- restart semantics;
- deployment requirements.

Implementation summaries must focus on changed files and meaningful behaviour.

Do not list unchanged files.

Do not claim work is complete when verification has not been run or has failed.
