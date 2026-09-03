# Actor Gateway running-request recovery

## Goal

Allow Actor Gateway to advance a durable pending or running request when a
consumer reads its status, so Discovery can observe a provider run to a
terminal archive/failure state instead of waiting forever on a stale stored
status.

## Current context

The live Discovery scope GB references Actor Gateway request
e1022688-cdeb-4a09-becc-4ab1807cda2a. Its provider run ID is persisted, but
the Gateway request has remained RUNNING since its initial POST. Discovery
correctly polls the Gateway once per worker tick and reports
provider-run-pending. The Gateway GET endpoint only reads MongoDB; execution
and provider-status reconciliation currently happen only on POST.

## Constraints

- Never start a second provider run when the persisted request has a provider
  run ID. Status reconciliation must call provider getRun only.
- Preserve existing execution claims, stale-claim recovery, exact request
  reuse, archive creation, and terminal idempotency.
- Keep canonical/provider details inside Actor Gateway. Discovery continues to
  consume only the existing request-status contract.
- Do not create a new live actor run while diagnosing or testing this fix.

# Plan steps

## Step 1 - Add a durable execution-input read port

**Status:** Done

### Objective

Let the Actor Gateway application reconstruct the validated original resolve
input for a persisted request without leaking MongoDB documents.

### Observable result

The request repository can return the original typed resolve input for an
existing request, including canonical input, actor definition/revision, cache
policy, correlation ID, and schema version.

### Implementation

1. Extend the owner-side repository port with a narrow execution-input query.
2. Reconstruct and validate the input in the MongoDB adapter from persisted
   request fields and canonical JSON.
3. Add adapter/application tests for found, missing, and invalid durable
   input.

### Verification

- Actor Gateway lint, typecheck, tests, and build pass.

### DoD

- A pending/running request can be safely resumed from durable state after a
  restart.

### Done

Added the repository execution-input query and MongoDB reconstruction through
the shared contract parser. The integration test covers durable input recovery
and a missing request; all Actor Gateway quality gates pass.

## Step 2 - Reconcile runs when status is read

**Status:** Done

### Objective

Use the stored input and existing execution service to advance non-terminal
requests on GET status without duplicating provider starts.

### Observable result

GET /v1/actor-requests/{requestId} returns an updated terminal status when the
provider has completed or failed, or the current running status otherwise.

### Implementation

1. Make ActorGatewayService load the durable input and invoke the existing
   execution service only for pending/running requests.
2. Preserve terminal GET behavior and return not found unchanged.
3. Add tests proving a stored providerRunId leads to provider getRun rather
   than startRun, and that a successful result archives records once.
4. Ensure transient provider status errors remain explicit/retryable and do
   not overwrite the durable request as an ordinary failed business decision.

### Verification

- Unit tests cover pending, running, succeeded, failed, missing input,
  provider success, provider failure, and transient provider errors.
- Actor Gateway lint, typecheck, tests, and build pass.

### DoD

- Discovery can observe an existing provider run progress after Gateway or host
  restart without creating another provider run.

### Done

GET status now resumes non-terminal requests through the existing execution
service. Provider-run reuse is covered by tests that prove getRun, not a
second startRun, is used for completion and failure paths.

## Step 3 - Complete active Discovery operation runs on terminal work

**Status:** Done

### Objective

Keep a manually requested Discovery operation attached to the campaign worker
until the underlying provider/import work reaches a terminal outcome.

### Observable result

Runs that became running while a provider request was pending transition to
completed or failed on a later terminal worker tick. Concurrent manual
requests for the same in-progress campaign work are coalesced rather than
causing a second provider run.

### Implementation

1. Add narrow repository operations to locate active campaign runs and finish
   their shared campaign work atomically enough for the single worker model.
2. Have the worker retain an active operation context on later ticks, use its
   budget only when starting new scope work, and close all coalesced active
   requests after a terminal outcome.
3. Test provider-pending followed by later import completion, failure, and
   coalesced manual requests without an additional provider start.

### Verification

- Discovery lint, typecheck, tests, and build pass.
- The existing GB import completes the existing manual requests without
  starting the IE provider scope.

### DoD

- A frontend Run reaches a truthful terminal status after its asynchronous
  campaign work completes.

### Done

The worker now retains the oldest running operation context on later ticks and
finishes coalesced accepted/running requests for the same campaign after a
terminal outcome. Tests cover provider-pending followed by import completion
without claiming a second manual request. Discovery quality gates pass.

## Step 4 - Verify the live stuck request and close

**Status:** Done

### Objective

Deploy the corrected local container and verify the existing request progresses
using its persisted provider run ID.

### Observable result

The existing Gateway request and corresponding Discovery scope leave the
permanent RUNNING loop, or expose a durable terminal failure with diagnostics.

### Implementation

1. Rebuild/restart only Actor Gateway and dependent Discovery as needed.
2. Inspect structured logs, MongoDB request/scope/run records, and BFF run
   status after one or more worker ticks.
3. Update ACTUAL_STATE.md and this plan with the observed result. Do not issue
   a new manual Discovery Run or actor start.

### Verification

- All applicable quality gates pass.
- The existing provider run is queried; no additional provider run is started.

### DoD

- The user-visible Run no longer waits indefinitely because Gateway status
  reads are stale.

### Done

Rebuilt Actor Gateway and Discovery, then reconciled the pre-existing provider
run through a Gateway status read without creating a new provider run. GB
completed with 100 persisted Leads. The two pre-existing coalesced manual run
records were repaired from the legacy running state to completed; the BFF
returned the completed run and a 10-item page with total 100 while Discovery
was briefly healthy. Discovery was then stopped before its next scheduled tick
would begin the configured IE provider search.

## Step 5 - Add compact Lead data actions

**Status:** Done

### Objective

Make each visible Lead data row directly reusable without selecting text, and
make website information recognisable rather than a generic label.

### Observable result

Lead name, address, phone, metrics/machine data, and website rows have compact
right-aligned copy controls. Website rows display their hostname and include
copy-URL and open-in-new-tab icon buttons sized to the text row.

### Implementation

1. Add accessible Material icon actions and a Clipboard API integration to
   Discovery and Qualification cards.
2. Derive a safe display hostname from the website URL without exposing its
   full path as the row label.
3. Use responsive row layout so long data wraps without displacing its actions.

### Verification

- Frontend unit tests cover hostname derivation and clipboard invocation.
- Frontend lint, typecheck, tests, and build pass.

### DoD

- Every displayed data row has an accessible copy action.
- A website row shows its hostname, copies its full URL, and opens the full URL
  in a new tab with safe link attributes.
- The controls stay aligned and usable at all four responsive ranges.

### Done

Discovery and Qualification cards now use compact accessible Material icon
actions for every displayed data row. Website rows show a parsed hostname,
copy the full URL, and open it safely in a new tab. Hostname and clipboard
behaviour are unit tested; frontend lint, typecheck, tests, and build pass.

## Step 6 - Add URL-synchronised Material pagination

**Status:** Done

### Objective

Replace bespoke Previous/Next controls with Angular Material pagination that
supports direct navigation and a shareable current page.

### Observable result

Both result locations use `mat-paginator`; page navigation updates a `page`
query parameter, restores it when the page opens or browser history changes,
and presents the current page plus up to two adjacent pages on either side.

### Implementation

1. Bind page index and total to `MatPaginator`, retaining the fixed 50-item
   server limit.
2. Add a compact numbered-page window around the Material paginator.
3. Synchronise the page query parameter on pagination, campaign, tab, and sort
   changes; restore it on initial load and browser back/forward navigation.

### Verification

- Frontend unit tests cover page window selection and URL updates/restoration.
- Frontend lint, typecheck, tests, and build pass.

### DoD

- Top and bottom controls always operate on the same page and use Angular
  Material's paginator.
- The URL identifies the selected one-based page and can restore it on reload.
- At most two preceding and two following numbered pages are visible around the
  active page, within the available page range.

### Done

Both result locations now use `mat-paginator` with first/last controls and a
numbered current-page window of up to two preceding and two following pages.
The selected one-based page is stored in the `page` query parameter, restored
on initial load, and reapplied after browser back/forward navigation. Tests
cover the page window and Angular URL state; frontend lint, typecheck, 17
tests, and production build pass. The rebuilt frontend responds successfully
on port 4200.

## Step 7 - Improve Lead action visibility and proximity

**Status:** Done

### Objective

Make copy and external-link actions unmistakable and position them beside the
value they act on rather than at the remote edge of a wide card.

### Observable result

Every action has a high-contrast icon and visible compact surface immediately
after its data value; hover/focus feedback and tooltips identify the action.

### Implementation

1. Move row actions from a space-between layout to the natural end of the data
   value.
2. Set explicit high-contrast Material icon-button colours, borders, and state
   feedback for the dark theme.
3. Add Material tooltips to icon-only controls.

### Verification

- Frontend lint, typecheck, tests, and build pass.
- Inspect the rebuilt console at desktop width.

### DoD

- Copy and external-link controls are readily visible without hover.
- Each control sits immediately to the right of its associated value.
- Keyboard focus and tooltip text communicate the action.

### Done

Lead actions now sit immediately after their values on a high-contrast circular
surface, with visible hover/focus feedback and Material tooltips. The rebuilt
desktop console was visually checked: copy buttons and the website's copy and
new-tab controls are distinct and legible. Frontend lint, typecheck, tests,
and build pass.
