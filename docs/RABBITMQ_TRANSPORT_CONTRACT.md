# RabbitMQ Discovery-to-Qualification transport

## Compatibility decision

`@scout/contracts` defines the only public Discovery-to-Qualification message:
`DISCOVERED_LEAD`, schema version `1`. It preserves the semantic fields in
Discovery's existing version-1 outbox payload: `eventId`, `correlationId`,
`campaignId`, `occurredAt`, and the provider-neutral lead snapshot.

The transport representation deliberately serializes `occurredAt` as an
ISO-8601 UTC string. Discovery currently holds it as a `Date` in memory, so a
publisher performs that representation conversion without changing the event
meaning. The existing outbox payload does not have an event-type field; the
publisher adds the fixed `DISCOVERED_LEAD` discriminator when it creates the
transport envelope. No Discovery persistence document or provider DTO is a
contract field.

`lead.sourceKind` is an open, non-empty source identifier rather than an enum
owned by Discovery. This keeps the public contract independent of Discovery's
current provider list while retaining the deterministic `(sourceKind,
externalId)` identity pair.

## Topology

| Resource | Kind | Durable | Purpose |
| --- | --- | --- | --- |
| `discovery.lead.v1` | topic exchange | yes | Discovery's versioned event exchange |
| `lead.discovered.v1` | routing key | n/a | Routing key for `DISCOVERED_LEAD` v1 |
| `qualification.discovered-lead.v1` | queue | yes | Qualification's primary input queue |
| `qualification.discovered-lead.v1.retry.30s` | queue | yes | First bounded delayed retry queue, TTL 30 seconds |
| `qualification.discovered-lead.v1.retry.5m` | queue | yes | Final bounded delayed retry queue, TTL 5 minutes |
| `qualification.discovered-lead.v1.dead-letter` | queue | yes | Terminal malformed or permanently failed deliveries |

Discovery publishes persistent messages with publisher confirms and mandatory
routing. Qualification consumes with manual acknowledgements and the bounded
prefetch configured for that service. Retry metadata carries the attempt count;
after the configured maximum, processing routes to the dead-letter queue rather
than requeueing indefinitely. Qualification moves retry and dead-letter
messages with publisher confirms before acknowledging the original delivery;
the retry queues dead-letter back to the Discovery exchange after their TTL.
