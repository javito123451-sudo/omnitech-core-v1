---
name: ACE — Ava Context Engine
description: In-memory session context layer. Source of truth for active user, page, module, entity, clock state. Phase 0 of ACE+AIE+OmniTime architecture.
---

# Ava Context Engine (ACE)

## What it is
Single source of truth for live session context (what the user is doing right now). No business logic, no AI, no DB writes. SRP.

## Backend location
`artifacts/api-server/src/ace/`
- `types.ts` — interfaces (AceContext, AceEntity, AceWorkday, AceClockStatus, AceClockMethod)
- `contextStore.ts` — Map<`orgId:userId`, StoreEntry>, TTL 2h, prune every 15 min
- `index.ts` — public API (all functions; consumers only import from here)
- `routes/ace.ts` — GET/PATCH /api/ace/context (mounted in routes/index.ts)

## Frontend location
`artifacts/omniflow/src/`
- `lib/aceContext.tsx` — AceProvider + useAce() hook, 300ms debounced PATCH
- `hooks/usePageTracker.ts` — route→module slug map, entity ID extraction

## Multi-tenant isolation
Context key: `${orgId}:${userId}` — same pattern as `conversationState.ts`.
Identity fields (orgId, userId, orgRole, permissions) always sourced from `req.*` — never accepted from client payload.

## Mounting pattern
```
<AceProvider>        ← wraps MainLayout return
  <AcePageSync />   ← sentinel component that calls usePageTracker()
  <AvaProvider>     ← existing Ava provider
    ...
  </AvaProvider>
</AceProvider>
```
AcePageSync is a separate component so usePageTracker() runs inside AceProvider's tree.

## Public API
```typescript
getCurrentContext(orgId, userId) → AceContextView | null
setContext(orgId, userId, clerkUserId, overrides?) → AceContextView
updateContext(orgId, userId, partial) → AceContextView | null
clearContext(orgId, userId) → void
touchActivity(orgId, userId) → void
getActiveClient(orgId, userId) → AceEntity | null
getActiveProject(orgId, userId) → AceEntity | null
getActiveConversation(orgId, userId) → AceEntity | null
getActiveQuote(orgId, userId) → AceEntity | null
getCurrentWorkspace(orgId, userId) → { orgId, orgRole } | null
getCurrentSession(orgId, userId) → { sessionStartedAt, lastActivity, inactiveFor } | null
getCurrentModule(orgId, userId) → string | null
getCurrentWorkday(orgId, userId) → AceWorkday | null
getClockStatus(orgId, userId) → AceClockStatus | null
aceStoreSize() → number
```

## Dependency direction (strict, never reversed)
OmniTech Core → ACE → AIE → Action Engine → Modules

## Next phases
- Phase 1: AIE (Ava Intelligence Engine) — event bus + dispatcher
- Phase 2: Action Engine — executes AIE decisions
- Phase 3: OmniTime — uses ACE + AIE + Action Engine from the start
