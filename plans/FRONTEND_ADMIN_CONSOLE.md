# Frontend Admin Console

## Goal

Create an independently buildable Angular administrative console for the
browser-facing BFF. The console provides responsive visual management of the
existing Discovery and Qualification stages, uses Angular Material and SCSS,
starts in a dark theme, and never accesses a service database or service API
directly.

The UI may label a configured business category as hotels, but route,
transport, and model names retain the generic Lead vocabulary.

## Current Context

- BFF is the only intended browser API at http://127.0.0.1:3000/api/v1.
- It proxies typed HTTP contracts to Discovery and Qualification and has no
  database client for their MongoDB databases.
- Discovery configuration APIs exist, but no endpoint returns a paginated
  Discovery Lead read model.
- Discovery Lead identity is global, while discovery_outputs already carries
  the durable unique campaignId plus leadId membership. The Discovery list must
  read that owner-side membership rather than pretending that the global Lead
  collection has a campaignId.
- Qualification exposes only qualified Leads. The requested screen needs all
  Qualification-owned inbox Leads, including pending, rejected, and
  indeterminate records; that requires an owner-side query before the
  frontend can render it correctly.
- No Angular workspace or frontend package exists.

## Direction

Browser -> Angular console -> BFF -> Discovery and Qualification owner APIs.

The console is an independently buildable/deployable package. In Compose it
calls BFF only; Discovery and Qualification do not become browser APIs.

## Constraints

- Immediately before implementation, verify current stable Angular and Angular
  Material releases from their official registry. Pin every frontend dependency
  and devDependency to an exact version in frontend/package.json; ranges and
  tags are not allowed.
- Use standalone Angular APIs, strict TypeScript, Angular Material, and SCSS.
  Follow the repository TypeScript rules: no any, as, object, suppression
  directives, or unvalidated external payloads. New internal object interfaces
  use the I prefix and closed strings use enums.
- Four responsive viewport ranges are compact phone (0-599px), phone
  landscape/tablet (600-959px), tablet/small desktop (960-1279px), and desktop
  (1280px and wider).
- The initial theme is dark. Do not infer a light theme from the OS.
- Lead pages have limit 50 and preserve BFF offset, limit, and total semantics.
  Both Lead collection endpoints accept validated sortBy and sortDirection
  values and apply sorting before pagination; the browser must never sort only
  the current page.
- Discovery sorting supports createdAt and name. Qualification supports those
  fields plus every existing computed metric: publicAdr, reviewVolume,
  marketPricePosition, monetisableAssetCount, fullServiceHotelSignal, and
  marketValueProxy. Every ordering ends in a stable leadId tie-breaker.
- A missing/unavailable Qualification metric is not a numeric zero. Its records
  always sort after records with an available value, for ascending and
  descending order. This rule is visible in the UI and preserves metric
  availability semantics.
- Persist only the selected top-level tab in localStorage. Encapsulate its key,
  invalid-value recovery, and unavailable-storage handling.
- Configurations are ordered createdAt DESC with a stable identifier
  tie-breaker. Add owner-side ordering if an existing contract does not
  guarantee it.
- Show loading, empty, command-pending, malformed-response, and recoverable
  API-failure states. Do not present a failed command as successful.
- Do not expose provider DTOs, raw actor archives, persistence documents, or
  cross-service joins to the frontend.

## Non-Goals

- Authentication, authorization, multi-user preferences, and public exposure.
- New provider behaviour, qualification rules, opportunity analysis, editing
  existing configurations, archive/activation management, or raw actor archive
  viewing.
- A live event stream beyond short-lived command-state refreshes.

## Decisions Needed Before Step 2

1. Does Create new create a Discovery configuration, a Qualification
   configuration, or a coordinated pair? Existing APIs require different
   fields and independent immutable revisions, so one generic form cannot
   safely invent missing values.
2. For Discovery Run, should the UI submit the active configuration maximum
   per-run limit, or let the operator choose a smaller bounded amount?
3. Which actor-sourced card fields are useful beyond name, address, website,
   phone, internal Lead ID, source kind, external source ID, and timestamps?
   The normalized model currently contains these fields.

# Plan steps

## Step 1 - Reconcile UI contracts and the active plan

**Status:** Pending

### Objective

Resolve the open operator decisions and write the exact generic transport
semantics before changing any backend implementation.

### Observable result

The plan records resolved dialog, Run-budget, and card-field decisions plus
one unambiguous request/response specification for each Lead collection.

### Implementation

1. Record the three user decisions above in this plan.
2. Define request enums and page contracts: offset, limit, sortBy, and
   sortDirection; all responses contain items, offset, limit, and total.
   total is calculated after filters and before pagination.
3. Define default ordering as date added descending then Lead ID ascending,
   an explicit name collation, and Lead ID as the final deterministic
   tie-breaker for every requested ordering.
4. Define numeric/ordinal metric sort semantics and unavailable metric values:
   unavailable is never zero and always follows available values in either
   direction.
5. Reserve singular Qualification Lead routes for details and collection routes
   for pages. Record public owner and BFF paths in docs/BFF_LOCAL_API.md.

### Verification

- Contract examples cover all accepted sort values, invalid query values, page
  boundaries, defaults, deterministic ties, and unavailable metric order.
- The next four implementation steps are reviewed against the actual port and
  persistence boundaries.

### DoD

- The contract is ready for separate Discovery, Qualification, and BFF work.
- The resolved UX decisions are recorded before UI implementation begins.

## Step 2 - Add the Discovery campaign Lead read model

**Status:** Pending

### Objective

Expose a paginated, deterministic Discovery-owned list for the selected
campaign without treating global Lead identity as campaign membership.

### Observable result

Discovery serves GET /v1/discovery/leads with campaignId, offset, limit,
sortBy, and sortDirection. The response contains items, offset, limit, and
total and supports Date added and Name order.

### Implementation

1. Add a narrow inbound query port, application query service, and
   owner-side read repository contract.
2. Base membership on the unique campaignId plus leadId discovery output record
   and resolve the normalized Lead snapshot inside Discovery only. Date added
   means membership createdAt, not the global Lead updatedAt value.
3. Validate all query values with enums and bounded pagination; apply sorting
   before skip/limit and use the contract tie-breaker.
4. Add the required owner-side indexes or projection fields for efficient
   campaign/date/name ordering. MongoDB shapes remain in the adapter.
5. Add a thin Discovery HTTP controller and document the owner endpoint.

### Verification

- Application/repository tests cover campaign isolation, global duplicate Lead
  identity, name/date asc/desc, ties, empty pages, and total correctness.
- Controller tests cover malformed pagination and sort values.
- Discovery lint, typecheck, tests, build, and architecture import review pass.

### DoD

- Discovery returns a truthful page of campaign Leads without cross-service or
  direct browser persistence access.

## Step 3 - Proxy Discovery Lead pages through BFF

**Status:** Pending

### Objective

Make the Discovery list available at the sole browser boundary.

### Observable result

BFF serves GET /api/v1/discovery/leads and preserves the validated page,
sorting semantics, correlation ID, and safe owner errors.

### Implementation

1. Extend the typed Discovery management client and BFF transport parser with
   the Step 1 request/response contracts.
2. Add a thin BFF controller route that forwards only supported query values.
3. Preserve owner status codes and safe response bodies; do not add BFF
   persistence, joins, sorting, or fallback data.
4. Update BFF API documentation and contract fixtures.

### Verification

- BFF adapter/controller tests cover forwarding, correlation propagation,
  validation failures, owner errors, and page-body preservation.
- BFF lint, typecheck, tests, build, and no-database-access review pass.

### DoD

- Browser clients can obtain Discovery Lead pages only through BFF.

## Step 4 - Add the Qualification full Lead read model and metric ordering

**Status:** Pending

### Objective

Expose every Qualification-owned inbox Lead for a campaign/profile with
truthful decision/enrichment state and server-side ordering by the six metrics.

### Observable result

Qualification serves GET /v1/qualification/leads with campaignId,
profileVersion, offset, limit, sortBy, and sortDirection. It returns items,
offset, limit, total, Lead/date-added data, decisions when present, and
explicit metric availability.

### Implementation

1. Extend the read port and application query service from qualified-only pages
   to a full inbox page. Keep unevaluated, processing, rejected, indeterminate,
   and qualified Leads distinct.
2. Use inbox receipt time as Date added; add it to the owner read model if it
   is not currently queryable.
3. Support Date added, Name, Public ADR, Review Volume, Market Price Position,
   Monetisable Asset Count, Full-Service Hotel Signal, and Market Value Proxy.
4. Convert the persisted metric collection into owner-side typed sortable
   projections or equivalent indexed fields. Preserve metric availability and
   evidence; do not fabricate a zero or a decision.
5. Define Full-Service signal ordinal order and metric null-last behavior in
   the repository implementation; keep MongoDB aggregation/query details
   inside the adapter.
6. Add the thin Qualification HTTP collection controller without changing the
   existing singular Lead-detail route.

### Verification

- Application/repository tests cover every decision state, no decision,
  all metric sort options/directions, unavailable metrics, ordinal ordering,
  campaign/profile isolation, stable ties, total, and empty pages.
- Controller tests reject invalid pagination/profile/sort values.
- Qualification lint, typecheck, tests, build, and architecture import review
  pass.

### DoD

- Qualification returns a complete, auditable page without an implicit
  qualified-only filter or incorrect metric semantics.

## Step 5 - Proxy Qualification Lead pages through BFF

**Status:** Pending

### Objective

Publish the full Qualification Lead page through the BFF without changing data
ownership.

### Observable result

BFF serves GET /api/v1/qualification/leads while retaining the existing
singular detail path and all owner pagination/sort/error semantics.

### Implementation

1. Extend the typed Qualification client/parser and controller with the
   validated collection route.
2. Forward campaign, profile, pagination, and sort query values with a
   correlation ID; do not pass arbitrary query values through.
3. Add BFF contract fixtures/tests and update docs/BFF_LOCAL_API.md.

### Verification

- BFF tests cover every query mapping, malformed owner data, error propagation,
  and collection/detail route separation.
- BFF lint, typecheck, tests, build, and no-persistence-access review pass.

### DoD

- The complete Qualification list is reachable exclusively via BFF.

## Step 6 - Bootstrap the Angular console and deployment path

**Status:** Pending

### Objective

Add a strict independently buildable Angular application with pinned
dependencies, Material, SCSS, tests, and local runtime configuration.

### Observable result

The frontend builds, tests, lint-checks, serves a dark shell, and reaches the
BFF through a configurable base URL only.

### Implementation

1. Add a frontend Angular workspace/package using current stable versions
   verified at implementation time and exact versions in package.json and lock
   file. Enable strict compiler, template, and Angular checks.
2. Configure Angular-aware linting consistent with repository TypeScript rules.
3. Add BFF base-URL runtime configuration, a development proxy, and Compose
   static-serving configuration that does not hard-code a container hostname.
4. Add a local Compose service and document its URL, startup, CORS origin, and
   trusted-local security boundary.
5. Add dark Material tokens, typography, focus states, accessibility defaults,
   and SCSS organization.

### Verification

- Install from the lock file; run lint, strict typecheck, unit tests, production
  build, and a Compose smoke test.
- Inspect network requests to prove the frontend calls only BFF and api/v1.
- Test dark mode, focus visibility, and recoverable API errors.

### DoD

- The console is reproducible from exact dependencies and reaches BFF through
  documented local runtime configuration.

## Step 7 - Add the frontend BFF client and page primitives

**Status:** Pending

### Objective

Provide the console with a strictly typed, validated way to use the completed
BFF Lead/configuration/command contracts before creating feature screens.

### Observable result

Feature code obtains pages, configurations, and command results from typed
facades, while one reusable set of page/error/loading primitives handles
transport concerns consistently.

### Implementation

1. Add boundary parsers for Discovery/Qualification configuration pages, both
   Lead page contracts, Run, and Requalify command resources.
2. Build a BFF HTTP client with base URL runtime configuration, correlation ID
   handling, timeout/cancellation, and safe error normalization.
3. Add reusable page-state, pagination, loading, empty, retry, and command
   feedback primitives. They retain BFF offset, limit, and total semantics.
4. Test malformed server values, network failures, cancellation on route/tab
   change, and no direct calls to Discovery or Qualification origins.

### Verification

- Frontend unit tests cover every parser and all shared asynchronous states.
- Browser-network smoke test shows only BFF api/v1 requests.
- Frontend lint, typecheck, tests, and build pass.

### DoD

- Feature components need no ad hoc fetch logic, unchecked JSON, or duplicate
  pagination/error handling.

## Step 8 - Build configuration selection and creation

**Status:** Pending

### Objective

Implement reusable stage-aware configuration selection and an anchored
configuration-creation flow.

### Observable result

Each tab has a newest-first vertically scrollable configuration list, country
code markers from scopes, a fixed-bottom Create new action, and an accessible
dialog for the agreed configuration type.

### Implementation

1. Build a feature-scoped configuration state facade and presentation models.
   Retain selection per stage in memory; select the newest active record if a
   refresh removes the current selection.
2. Render two-letter country or region codes only when scope IDs are valid
   display codes; use an explicit non-country fallback for generic scopes.
3. Keep the action fixed while its list scrolls, without unintended nested
   page scrolling.
4. Implement the resolved creation dialog or dialogs. Validate locally for
   usable feedback, submit to BFF, surface safe validation/conflict errors, and
   refresh/select the new draft.
5. Preserve independent Discovery and Qualification versioned forms; never
   manufacture one configuration from the other.

### Verification

- Component tests cover ordering, selection, scroll/action layout, scope-code
  fallback, dialog validation, BFF errors, and successful draft selection.
- Keyboard and screen-reader tests cover selection, focus trap, errors, and
  escape/cancel.
- Check all four responsive ranges.

### DoD

- An operator can select and create the agreed configuration type without
  direct API access or loss of context.

## Step 9 - Deliver responsive shell, tabs, and tab persistence

**Status:** Pending

### Objective

Create the primary navigation and adaptive stage layout.

### Observable result

A thin top bar holds Discovery and Qualification tabs, restores the last valid
tab after reload, and each tab exposes an ergonomic configuration/result layout
at all four viewport ranges.

### Implementation

1. Use accessible Material tabs. Persist a closed enum value under a namespaced
   localStorage key; default safely to Discovery for absent/corrupt values.
2. At 1280px and wider use the requested fixed-width left rail and flexible
   result pane. At 960-1279px reduce rail width/card density. At 600-959px use
   a collapsible top configuration selector. Below 600px use a full-width
   selector ahead of results with touch-sized actions.
3. Let the result region own long-list scrolling where practical while keeping
   the create action and stage context visible.
4. Provide shared page-header, pagination, empty/loading/error, and
   command-feedback components with responsive SCSS.

### Verification

- Tests cover valid and malformed stored tab values.
- Browser checks at 375px, 768px, 1024px, and 1440px verify no horizontal
  overflow, visible controls, selection, and keyboard navigation.
- Accessibility audit covers tab semantics, contrast, focus order, dialogs,
  and status announcements.

### DoD

- The console begins dark, restores the selected tab safely, and works at all
  four documented breakpoints.

## Step 10 - Implement Discovery list, pagination, and Run

**Status:** Pending

### Objective

Render Discovery Leads for the selected campaign and provide a truthful
asynchronous Run interaction.

### Observable result

Discovery shows 50 Leads per page with top/bottom pagination. An empty campaign
shows a centered Run button; a populated list shows smaller green Run buttons
at the right of both pagination bars. Cards distinguish readable data from
machine IDs.

### Implementation

1. Request the Discovery Lead endpoint with limit 50; reset offset on campaign
   or sort change and disable impossible page transitions. Send server-side
   sortBy and sortDirection, defaulting to date added descending.
2. Render h3 Lead names, prominent address/website/phone where present, and
   subdued Lead ID, source kind, external ID, and timestamps. Use semantic
   website/phone links.
3. Add compact sort controls for Name and Date added with an explicit ascending
   or descending direction and an accessible current-sort announcement.
4. Submit the resolved bounded Run request with an idempotency key per user
   intent. Clearly display accepted, already-running, quota, validation, and
   failure outcomes.
5. Refresh command/result state with bounded cancellable polling tied to the
   active page. Never claim a Lead exists until BFF returns it.

### Verification

- Tests cover empty/populated/loading/error, concurrent-click prevention,
  command outcomes, date/name sort directions, 50-item boundaries, and
  top/bottom control placement.
- Browser tests cover all responsive ranges.
- Tests mock BFF: no provider calls occur.

### DoD

- Discovery results and commands are accurate, accessible, and usable by
  keyboard, mouse, and touch.

## Step 11 - Implement Qualification list, statuses, and Requalify

**Status:** Pending

### Objective

Render every Qualification-owned campaign Lead with clear decision states and
provide safe individual requalification.

### Observable result

Qualification has top/bottom pagination, shows all received Leads by default,
emphasizes qualified Leads, shows rejected/indeterminate Leads subdued but
actionable, and gives every card a Requalify action. An empty campaign displays
centered text: There are nothing yet.

### Implementation

1. Request the Qualification collection endpoint with campaign, selected active
   profile, offset, limit 50, sortBy, and sortDirection. Paginate the full
   inbox, not qualified-only records. Reset offset on campaign, profile, or
   sort change.
2. Map explicit server states to accessible badges: green check Qualified, red
   cross Rejected, neutral Indeterminate, and a pending/unevaluated state.
   Muting must not create disabled semantics or illegible text.
3. Add accessible sort controls for Name, Date added, and all six metrics:
   Public ADR, Review volume, Market price position, Monetisable asset count,
   Full-service hotel signal, and Market value proxy. For unavailable metric
   values, show that the server places them last; never turn them into zero for
   display or ordering.
4. Reuse the Discovery card hierarchy and show reasons, profile, execution,
   and enrichment state only when meaningful and present.
5. Submit Requalify with campaign, Lead ID, profile, and idempotency key.
   Disable only that card action while pending, surface errors, then refresh
   affected page/status.
6. Keep the exact empty string in one presentation constant and center it on
   both axes in the usable result pane.

### Verification

- Tests cover qualified, rejected, indeterminate, pending, absent decision,
  error, duplicate-click, requalification-pending states, every sort option,
  metric availability ordering, and sort-reset pagination.
- Verify readable contrast and screen-reader text for all badges.
- Browser tests cover full-list pagination, empty state, controls, and
  Requalify across all responsive ranges.

### DoD

- Operators see every received Lead, its qualification state, and can safely
  request reevaluation.

## Step 12 - Verify, document, and close the plan

**Status:** Pending

### Objective

Prove the console against Compose and record the verified implementation.

### Observable result

All quality gates pass, the UI works through BFF against controlled data, and
documentation accurately states setup and limitations.

### Implementation

1. Add browser tests with mocked BFF transport and a controlled Compose smoke
   path using seeded/sanitized data. Do not call live providers.
2. Run lint, strict typecheck, tests, integration tests, production builds, and
   contract/API tests for every affected package.
3. Review boundaries: frontend calls BFF only; BFF uses typed HTTP clients;
   service read models remain owner-side; provider/database SDKs never reach
   frontend or BFF.
4. Update docs/BFF_LOCAL_API.md, Compose/runtime documentation, and root .env
   plus .env.example together for any frontend port/origin. Update ACTUAL_STATE
   only once all plan steps are Done.
5. Add verified Done records and intentional deferrals to every plan step.

### Verification

- All listed quality gates pass from clean installs/builds.
- Manual responsive smoke test verifies tab recovery, configuration creation,
  lists, pagination, empty states, Run, and Requalify at four widths.

### DoD

- The delivered console is reproducible, documented, responsive, and verified
  against actual BFF contracts.

# Plan completion criteria

- A current pinned Angular/Material console is independently buildable through
  the trusted local Compose topology.
- It is dark by default, uses SCSS, supports four documented responsive ranges,
  and stores the selected top-level tab safely.
- Both stages have ordered scrollable configuration selection and a fixed-bottom
  creation action.
- Discovery and Qualification use validated BFF pagination at 50 Leads per page
  with offset, limit, total, server-side sorting, and show specified empty
  states and commands.
- Qualification displays all received Leads and clear usable decision statuses.
- Frontend and BFF never access Discovery or Qualification persistence directly,
  and tests never invoke a live provider.
