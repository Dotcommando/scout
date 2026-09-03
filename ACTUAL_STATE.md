# Actual System State

This document describes implemented code and configured Docker Compose
topology. It is not a roadmap: planned work is listed separately so it cannot
be mistaken for an implemented capability.

Last reviewed against the repository: 2026-09-03.

## Runtime Topology

```text
Discovery -- AMQP discovered-lead event --> Qualification
    |                                         |
    |                                         +--> scout_qualification
    +--> scout_discovery                         qualification decisions
                                                enrichment snapshots
                                                qualified lead outputs

Discovery ----> Actor Gateway ----> Apify actors
Qualification -> Actor Gateway
Actor Gateway -> scout_actor_gateway (request cache, runs, archives, field catalogue)
Browser (local) -> BFF -> Discovery and Qualification HTTP APIs
```

Docker Compose defines six containers: `mongodb`, `rabbitmq`, `actor-gateway`,
`discovery`, `qualification`, and `bff`. MongoDB data and RabbitMQ data use
named volumes and survive ordinary Compose recreation. MongoDB contains one database per service:
`scout_actor_gateway`, `scout_discovery`, and `scout_qualification`. No service
reads or writes another service's database.

All host ports are loopback-only. The no-auth BFF at `127.0.0.1:3000` is the
intended browser entry point; direct service and infrastructure ports exist
only for local troubleshooting.

## Discovery

### Responsibility

Discovery finds candidate Leads in configured scopes. The active campaign is
configured with the Google Maps source and the actor
`compass/crawler-google-places`; its current scopes are GB and IE.

### Inputs

- Discovery campaign configuration: campaign ID, source, actor ID, queries,
  ordered scopes, and provider limits.
- Runtime configuration: its MongoDB, RabbitMQ, and Actor Gateway connections.
- A scheduled worker tick, currently every 60 seconds.
- Actor Gateway request status and archived Google Maps records.

### Processing and stored output

- Persists scope progress, gateway-request references, quota reservations, Leads,
  and pending publication records in `scout_discovery`.
- Normalizes a provider record to a generic Lead: stable internal `leadId`,
  `(sourceKind, externalId)`, name, and optional address, phone number, and
  website URL.
- Enforces source identity persistence so an existing source entity is not
  emitted again as a newly discovered Lead.
- Uses a durable publication record and publisher lease before RabbitMQ
  publication. Confirmed messages are marked published; retryable publication
  failures are scheduled for another attempt.

### External output

For each newly discovered Lead, Discovery publishes a persistent JSON message
to RabbitMQ:

```text
exchange: discovery.lead.v1
routing key: lead.discovered.v1
schema: IDiscoveredLeadEvent, version 1
```

The event contains `eventId`, `correlationId`, `occurredAt`, `campaignId`, and
the normalized Lead snapshot (`leadId`, `sourceKind`, `externalId`, `name`,
plus optional address, phone number, and website URL).

## Qualification

### Responsibility

Qualification decides whether a discovered Lead is worth passing to a later
system according to the configured deterministic profile. The current profile
checks required Lead fields, configured source/website exclusions, and known
affiliation rules.

### Inputs

- The versioned discovered-lead event from RabbitMQ.
- A Qualification-owned active immutable configuration revision for the
  campaign. Bootstrap YAML is used only to seed an empty local database;
  runtime policy thereafter comes from `scout_qualification`.
- Runtime configuration: its MongoDB and RabbitMQ connections and consumer
retry settings.

### Processing and stored output

- Validates the public event schema and confirms AMQP message and correlation
  identifiers match the event body.
- Persists the received message, execution claim, explicit decision, and
  machine-readable reasons in `scout_qualification`.
- Idempotency key: campaign ID, Lead ID, and qualification profile version.
  Repeated delivery therefore reuses a completed decision instead of making a
  new one.
- Produces one of `qualified`, `rejected`, or `indeterminate`.
- For `qualified` only, writes a `READY` handoff record to the
  `qualified_lead_outputs` collection. This is a persistent output for a
  future downstream system; it is not currently published to another broker
  exchange or service.
- Requests a retained Google Hotels market snapshot through Actor Gateway and
  persists exactly six explicit metrics when an archived property record has
  the same stable external identifier as the Lead: Public ADR, Review Volume,
  Market Price Position, Monetisable Asset Count, Full-Service Hotel Signal,
  and Market Value Proxy. A missing match or field is stored as `UNAVAILABLE`,
  never as zero or a commercial decision.
- Exposes local HTTP configuration revision management, a manual execution
  command that resolves only its own inbox snapshot, campaign status, execution
  history/detail, qualified Lead pages, and Lead detail. Qualified pages use
  `recordedAt DESC, leadId ASC`, return offset/limit/total and `asOf`, and show
  enrichment state rather than default metric values.

### RabbitMQ handling

Qualification consumes queue `qualification.discovered-lead.v1`, which is
bound to Discovery's exchange and routing key. Delivery is at-least-once.
Transient failures are retried through 30-second and 5-minute retry queues;
malformed or terminally failed messages are written to
`qualification.discovered-lead.v1.dead-letter`.

## Shared Runtime Contracts

`packages/contracts` contains the stable transport contract only. It does not
contain service application or domain code. The currently shared contract is
the version-1 discovered-lead event consumed by Qualification.

All three services expose:

```text
GET /health/live   process liveness
GET /health/ready  MongoDB and RabbitMQ readiness
```

Actor Gateway readiness verifies MongoDB; Discovery and Qualification readiness
also verify RabbitMQ. Gateway archives complete gzip-compressed raw datasets in
GridFS, protects exact request reuse with a persistent key, retains a checksum,
and derives a JSON-Pointer field catalogue. Gateway request, archive manifest,
and archive-content endpoints are versioned under `/v1/actor-requests`.

The services use structured logs and propagate `correlationId` through the
Discovery-to-Qualification event and Actor Gateway requests.

## BFF

The independently deployable BFF owns no MongoDB client or service business
data. It forwards versioned local HTTP requests to Discovery and Qualification,
propagates `X-Correlation-Id`, provides local CORS, and reports liveness
separately from dependency readiness. Its documented surface is
`docs/BFF_LOCAL_API.md`; it includes Qualification configuration CRUD,
execution commands, status, and qualified-Lead query routes under `/api/v1`.

## Deferred Operational Work

- Live Google Hotels contract capture remains opt-in. No live provider call is
  performed by normal tests or Compose startup; fixtures and configuration must
  be reviewed before a paid capture is approved.

## Maintenance Rule

After every completed implementation plan, update this file before declaring
the plan complete. Describe only verified implemented behavior, changed
inputs/outputs, communication paths, and operational topology. Record planned
or deferred work only in the final section.
