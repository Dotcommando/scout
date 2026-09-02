# Discovery output migration

`scout_discovery.discovery_outputs` is the Discovery outbox. New records use
payload schema version `1` and contain a provider-neutral lead snapshot.

Records created before this change contain only IDs and status. Discovery does
not reconstruct or publish such records automatically: their original lead
snapshot and correlation ID cannot be recovered reliably from a later canonical
lead update.

For the current environment, all older records are test data. Stop Discovery,
select `scout_discovery` in MongoDB Compass Shell, inspect the affected count,
and remove only the confirmed test outputs:

```javascript
db.discovery_outputs.countDocuments({ payload: { $exists: false } })

db.discovery_outputs.deleteMany({ payload: { $exists: false } })
```

Do not use the deletion command for real pending outputs. Keep those records
pending and arrange an audited, versioned migration before enabling delivery.
New Discovery runs create delivery-ready outputs directly.
