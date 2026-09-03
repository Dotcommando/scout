# Discovery Run feedback

## Goal

Make a manual Discovery Run observable and safe in the admin console: one
intent creates one tracked run, the interface blocks a duplicate request,
shows progress while polling the owner state once per second, refreshes Leads
after completion, and presents a diagnosable failure when the run fails.

## Current context

Discovery already owns POST /v1/discovery/runs and GET
/v1/discovery/runs/{runId}. A created run returns 202 with a durable runId and
one of accepted, running, completed, or failed statuses; failed runs may carry
a safe failureMessage. BFF already forwards the equivalent api/v1 routes.
The current frontend drops the POST response, reloads the Lead page once, and
unblocks the button immediately. It neither retains the run ID nor observes a
terminal state.

## Constraints

- The browser calls BFF only; BFF and services keep data ownership unchanged.
- Poll exactly the created run at an interval of one second. Stop on a terminal
  status, selected campaign/tab change, component destruction, or a transport
  failure.
- A user action uses one idempotency key. A pending or observed run disables
  every Discovery Run control for that selected campaign.
- Do not call actors in tests. The UI must never infer success merely because
  the creation request was accepted.
- Surface only safe owner failure data; no raw actor response or stack trace is
  exposed.

# Plan steps

## Step 1 - Define and validate the tracked-run boundary

**Status:** Done

### Objective

Give the frontend a typed, validated representation of a submitted Discovery
run and its subsequently polled state.

### Observable result

The BFF client returns the POST run resource including runId and parses the
GET run resource with closed status values and an optional safe failure
message.

### Implementation

1. Confirm the owner/BFF response preserves runId, campaignId, status, and
   failureMessage without adding an unnecessary proxy endpoint.
2. Add frontend enums/interfaces and boundary parsers for the run resource;
   reject malformed JSON and unsupported statuses explicitly.
3. Add client methods for creating and retrieving one run. Reuse correlation
   handling and safe error normalization.

### Verification

- Unit tests cover accepted, running, completed, failed, malformed, and owner
  error responses.
- Frontend lint, typecheck, tests, and build pass.

### DoD

- The UI can reliably distinguish accepted/running from completed/failed using
  only BFF data.

### Done

Confirmed that the existing owner and BFF routes preserve the run resource.
Added strict frontend run-status parsing and typed POST/GET client methods.
Unit tests cover all four statuses, invalid status data, accepted POST data,
and an owner error.

## Step 2 - Implement the Discovery Run lifecycle in the console

**Status:** Done

### Objective

Connect the tracked-run contract to responsive, accessible UI feedback.

### Observable result

Clicking Run disables all Discovery Run buttons for the active campaign,
replaces the empty-state action with a central spinner and status text, polls
the created run every second, refreshes the current Lead page on completion,
and restores actionable controls with a clear error when the run fails.

### Implementation

1. Add a focused run-state model with run ID, status, error, and lifecycle
   cleanup. Prevent concurrent Run intents before the POST starts.
2. Show an aria-live status message and central spinner while accepted or
   running. Keep existing list visible when it is populated while disabling
   both compact Run actions.
3. Poll the exact run once per second. Stop polling and clean up timers on
   every terminal state, campaign/tab change, component destruction, and
   request error.
4. Treat completed as the only success terminal state and reload Leads then.
   Show a recoverable error that names a failed run and includes only its safe
   failure message where present.

### Verification

- Unit tests use fake timers and mocked BFF calls for duplicate clicks,
  accepted-to-running-to-completed, immediate completion, failure, poll error,
  tab/campaign change, and component teardown.
- Manual browser check confirms disabled controls, one-second polling, spinner,
  completion refresh, and failure presentation without actor calls.

### DoD

- An operator can always see whether the requested Run is in progress,
  completed, or failed, and cannot accidentally submit it twice.

### Done

Implemented an observation lifecycle keyed by the submitted runId. It blocks
duplicate Discovery Run intents, shows a live central spinner for an empty
result page, polls exactly once per second, refreshes Leads only after
completed, and exposes safe failure/polling errors while restoring Run.
Timers are cleared for terminal states, campaign/tab changes, and component
destruction. Chrome-hosted component tests cover the visible pending state,
duplicate clicks, completion, failed runs, polling errors, and cancellation.

## Step 3 - Verify and document the interaction

**Status:** Done

### Objective

Close the increment with repeatable evidence and accurate operator guidance.

### Observable result

The UI behavior is covered by automated frontend tests and the API document
states the tracked-run lifecycle expected by the console.

### Implementation

1. Run all applicable frontend quality gates and BFF checks if its contract is
   changed.
2. Add the local run-observation behavior to docs/BFF_LOCAL_API.md.
3. Record completed work and verification in this plan, then update
   ACTUAL_STATE.md if no planned work remains.

### Verification

- Lint, strict typecheck, tests, and production build pass.
- No test or manual check calls a real actor.

### DoD

- The interaction is documented, verified, and safe to extend with further
  operator feedback improvements.

### Done

Documented the BFF run-observation lifecycle and updated ACTUAL_STATE.md.
Final frontend lint, strict typecheck, Chrome unit tests, and production build
all pass. No test or verification call contacted a real actor.

# Plan completion criteria

- A Run remains visibly pending until Discovery records completed or failed.
- The browser polls only the created run once per second and never issues
  duplicate Run requests for the same active interaction.
- Completion refreshes the Lead page; failure is visible and recoverable.
