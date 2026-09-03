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
