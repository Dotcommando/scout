# Local BFF API

The BFF is the intended local browser entry point at `http://127.0.0.1:3000`.
It is deliberately unauthenticated and must not be exposed outside a trusted
development machine. Service, MongoDB, and RabbitMQ ports exist for local
debugging only and bypass the future authorization boundary.

The local Angular admin console is available at http://127.0.0.1:4200 after
docker compose up --build. It calls BFF only; BFF CORS explicitly allows its
two loopback origins. Its BFF base URL is read at browser startup from
`frontend/public/runtime-config.js`; change that file when the trusted local
BFF origin changes, then rebuild the frontend image.

All application routes use `/api/v1`. Supply `X-Correlation-Id` on an
operator request when tracing it across services; the BFF generates one when
it is absent. List responses use `items`, `offset`, `limit`, and `total`.

## Qualification configuration

`GET /api/v1/qualification/configurations?offset=0&limit=50` lists immutable
revisions. `POST` creates a draft, `PUT /{campaignId}` creates the next draft
with `expectedVersion`, `POST /{campaignId}/activate` activates a draft, and
`DELETE` archives a non-active batch using `{ "campaignIds": ["..."] }`.

The known-affiliation catalogue is seed-only in this release. A bundle must
reference the active immutable `catalogRevision`; catalogue edits are not
accepted through campaign configuration requests.

```powershell
Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/qualification/configurations?offset=0&limit=50'
```

## Qualification operations

`POST /api/v1/qualification/executions` accepts `campaignId`, `leadId`, and
optional `profileVersion` and `idempotencyKey`, returning `202` with the
durable execution identity. The Lead must already be in Qualification's
inbox; Discovery data is never read directly.

`GET /api/v1/qualification/status?campaignId=...&profileVersion=...` returns
the persisted snapshot counts and `asOf`. `remaining` is the number of unique
Qualification inbox Leads without a terminal decision for that profile.

`GET /api/v1/qualification/executions`, `/executions/{executionId}`,
`/qualified-leads`, and `/leads/{leadId}` provide troubleshooting and result
views. Qualified result pages are ordered by `recordedAt DESC, leadId ASC`.
Each Lead view returns an explicit enrichment state; a missing snapshot is
`pending`, never a fabricated metric value.

```powershell
Invoke-RestMethod 'http://127.0.0.1:3000/api/v1/qualification/status?campaignId=europe-gb-ie&profileVersion=1'
```

## Lead result pages

GET /api/v1/discovery/leads accepts campaignId, offset, limit, sortBy, and
sortDirection. It returns Discovery-owned campaign Lead membership and
supports createdAt and name sorting.

GET /api/v1/qualification/leads accepts campaignId, profileVersion, offset,
limit, sortBy, and sortDirection. It returns every Qualification inbox Lead,
not only qualified Leads. It supports createdAt, name, publicAdr, reviewVolume,
marketPricePosition, monetisableAssetCount, fullServiceHotelSignal, and
marketValueProxy. Unavailable metrics sort after available values in both
directions.

Both page responses contain items, offset, limit, and total. The default order
is date added descending with leadId as a stable tie-breaker.

## Health

`GET /health/live` checks the BFF process. `GET /health/ready` also checks
Discovery and Qualification readiness, so it returns unavailable while either
dependency is down. The services retain their own `/health/live` and
`/health/ready` endpoints for operations.
