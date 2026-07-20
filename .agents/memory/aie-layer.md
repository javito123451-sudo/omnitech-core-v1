---
name: AIE — Ava Intelligence Engine
description: Platform-wide event bus infrastructure. Phase 1 of ACE+AIE+Action Engine architecture. Modules emit events; handlers react (Phase 4+).
---

# Ava Intelligence Engine (AIE) — Phase 1

## What it is
Internal event bus. Modules publish events; registered handlers react. Zero HTTP endpoints. Zero business logic in Phase 1. Pure infrastructure.

## Backend location
`artifacts/api-server/src/aie/`
- `types.ts`           — AieEvent, AieHandler, AieSubscription, IEventBus, AieEventSource, AieEventMeta
- `eventRegistry.ts`   — EVENT_TYPES constants (60+ events, 12 domains), EVENT_CATALOG, getEventMeta(), isKnownEventType()
- `eventBus.ts`        — InternalEventBus (Node EventEmitter wrapper), singleton `aieEventBus`
- `dispatcher.ts`      — registerHandler(), unregisterHandler(), getDispatcherSummary(), initDispatcher()
- `emit.ts`            — emitAieEvent() — the only function modules should call; auto-ID, orgId guard, fire-and-forget
- `handlers/index.ts`  — registerAllHandlers() stub — Phase 4 handler registrations go here
- `index.ts`           — public API re-export; initAIE(); getAieSummary()

## Startup wiring
`src/index.ts` → `.finally()` after `runStartupMigrations()`:
```typescript
startRecurringInvoiceScheduler();
initAIE();  // after migrations so handlers can safely query DB
```

## How a module emits an event
```typescript
import { emitAieEvent, EVENT_TYPES } from "../aie";

// At the END of a successful route handler, after res.send():
void emitAieEvent({
  type:    EVENT_TYPES.APPOINTMENT_CREATED,
  orgId:   req.orgId!,
  userId:  req.userId,
  source:  "appointments",
  payload: { appointmentId: newAppt.id, clientId: newAppt.clientId },
  timestamp: new Date().toISOString(),
});
```
`void` prefix = intentional fire-and-forget, no await.

## How a handler module registers (Phase 4+)
```typescript
// src/aie/handlers/timeHandler.ts
import { registerHandler } from "../dispatcher";
import { EVENT_TYPES }     from "../eventRegistry";

export function register(): void {
  registerHandler(EVENT_TYPES.TIME_CLOCK_IN, handleClockIn, "OmniTime: clock-in detector");
}

// src/aie/handlers/index.ts — add:
import { register as registerTimeHandlers } from "./timeHandler";
registerTimeHandlers();
```

## Multi-tenant isolation rule
Every `AieEvent` MUST have `orgId > 0`. `emitAieEvent()` blocks and warns if missing.
Handlers MUST always filter by `event.orgId` before any DB query.

## Debug mode
Set `AIE_DEBUG=true` env var → wildcard listener logs every event to console.

## Architecture constraint (never reverse this)
Modules → emit() → AIE → Dispatcher → Handlers → Action Engine → Modules
Handlers must NEVER emit new events (infinite loop risk).

## Diagnostics
`getAieSummary()` returns totalHandlers, totalBusSubscriptions, handler list.
Exposed via Control Center diagnostics endpoint (Phase 4+).
