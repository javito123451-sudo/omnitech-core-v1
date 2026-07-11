---
name: Event Bus + Big Data Architecture
description: IEventBus interface, InternalEventBus, emit() helper, system_events table, and Big Data migration plan.
---

## The contract (IEventBus)

`src/events/types.ts` defines `IEventBus` — the only interface a future `KafkaEventBus` must implement.
Three methods: `publish`, `subscribe`, `unsubscribe`.

## Singleton swap point

`src/events/index.ts` line ~13: `export const eventBus = new InternalEventBus();`
Replace with `new KafkaEventBus(config)` when Kafka arrives — zero business logic changes.

## emit() usage pattern

```typescript
import { emit } from "../events";
emit({
  type:    "crm.client.created",  // from OmniEventType in types.ts
  orgId,
  userId:  clerkUserId ?? null,
  module:  "crm",
  payload: { clientId: 42, name: "Acme" },
});
// Fire-and-forget: never await, never throws, never blocks HTTP response
```

## system_events table (FIX-AC)

Fields: `id` (BIGSERIAL), `event_id` (UUID), `org_id`, `user_id`, `event_type`, `module`, `payload` (JSONB), `created_at`.
5 indexes: `sys_evt_org_created`, `sys_evt_type`, `sys_evt_module`, `sys_evt_created`, `sys_evt_payload_gin` (GIN).

## Where emit() is wired (as of FIX-AC)

- `clientSkills.ts` — `crm.client.created`
- `appointmentSkills.ts` — `calendar.appointment.created`
- `quoteSkills.ts` — `sales.quote.created`
- `aiUsageLogger.ts` — `ai.chat.interaction` (every AI call)

## Adding new events

1. Add type to `OmniEventType` union in `src/events/types.ts`
2. Call `emit({ type: "...", ... })` after the business operation
3. Do NOT add to Drizzle schema — system_events uses raw SQL via db.execute()

## Next FIX letter

FIX-AC is the last applied. Next migration should be **FIX-AD**.

**Why:**
Event Bus decouples modules from each other and from future infrastructure (Kafka, Spark, Elasticsearch).
The `IEventBus` interface is the seam — business logic never knows about Kafka.
