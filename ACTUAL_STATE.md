# Actual System State

This document describes implemented code and configured Docker Compose
topology. It is not a roadmap: planned work is listed separately so it cannot
be mistaken for an implemented capability.

Last reviewed against the repository: 2026-09-02.

## Runtime Topology

```text
Discovery -- AMQP discovered-lead event --> Qualification
    |                                         |
    |                                         +--> scout_qualification
    +--> scout_discovery                         qualification decisions
                                                qualified lead outputs

Discovery -- direct Apify client --> Google Maps actor

Both services --> MongoDB and RabbitMQ
```

Docker Compose defines four containers: `mongodb`, `rabbitmq`, `discovery`,
and `qualification`. MongoDB contains one database per service:
`scout_discovery` and `scout_qualification`. Neither service reads or writes
the other service's database.

## Discovery

### Responsibility

Discovery finds candidate Leads in configured scopes. The active campaign is
configured with the Google Maps source and the actor
`compass/crawler-google-places`; its current scopes are GB and IE.

### Inputs

- Discovery campaign configuration: campaign ID, source, actor ID, queries,
  ordered scopes, and provider limits.
- Runtime configuration: its MongoDB and RabbitMQ connections and the Apify
  token.
- A scheduled worker tick, currently every 60 seconds.
- Provider-run status and paged result records from the Google Maps actor.

### Processing and stored output

- Persists scope progress, provider run references, quota reservations, Leads,
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
- Qualification profile and known-affiliation configuration for the campaign.
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

Both services expose:

```text
GET /health/live   process liveness
GET /health/ready  MongoDB and RabbitMQ readiness
```

Both services use structured logs and propagate `correlationId` through the
Discovery-to-Qualification event.

## Not Implemented Yet

- Actor Gateway is not yet an application, Docker Compose service, or runtime
  dependency.
- Discovery still calls Apify directly and receives `APIFY_API_TOKEN`.
- There is no shared actor-request cache, raw actor-response archive, or
  observed-field catalogue.
- Qualification does not yet call the Google Hotels actor and does not yet
  persist the six planned enrichment metrics.

The implementation plan for those changes is
`plans/QUALIFICATION_ENRICHMENT_AND_RESPONSE_ARCHIVE.md`.

## Maintenance Rule

After every completed implementation plan, update this file before declaring
the plan complete. Describe only verified implemented behavior, changed
inputs/outputs, communication paths, and operational topology. Record planned
or deferred work only in the final section.
