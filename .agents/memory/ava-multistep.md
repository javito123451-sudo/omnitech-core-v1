---
name: Ava multi-step conversation state
description: How Ava handles multi-turn skill flows — collecting missing params across messages
---

## The rule
POST /api/chat maintains per-user conversation state in memory so Skills
can ask for missing params one at a time, just like the original LLM Ava.

## Architecture (3 pieces)

### conversationState.ts — PendingSkillState store
- In-memory Map keyed `orgId:userId` (userId = req.userId ?? clerkUserId ?? "anon-{orgId}")
- TTL 10 min from `lastPromptAt` (idle-based, not createdAt)
- Fields: skillId, intent, collectedParams{}, missingParams[], createdAt, lastPromptAt
- Ephemeral: cleared on server restart (intentional, no DB needed)

### paramResolver.ts — free-text → param value
- `extractParamFromText(paramName, paramType, rawText)` → handles:
  - date/new_date: ISO, dd/mm/yyyy, hoy/mañana/lunes..domingo (next occurrence)
  - start_time: HH:MM, Xh, Xam/pm
  - amount: European format (1.200,50 → 1200.50)
  - client_name/name: strips Spanish prepositions
  - title/description: strips prefix phrases
- `promptForParam(skillId, paramName)` → per-skill conversational question
- `isSkipKeyword(text)` → detects "sin email", "no tengo", etc.

### chat.ts — STEP 0 (runs after intent classification, before routing)
1. **getPendingSkill** for this user
2. If pending AND new message is GENERAL_QUERY (plain answer): resume flow
   - Abort keywords → clearPendingSkill + "De acuerdo, lo dejo."
   - extractParamFromText for the next missing param
   - If next required param is "items" → redirect to /quotes or /accounting (no conversational collection)
   - If stillRequired.length === 0 → executeSkill + emitDomainEvent + format
   - Else → setPendingSkill (updated) + promptForParam (next param)
3. If pending AND new message is real intent → clearPendingSkill, fall through
4. In STEP 2 skill routing: if missingRequired.length > 0 → setPendingSkill + promptForParam + return

## Key invariants
- "items" param (create_quote / create_invoice) NEVER collected conversationally → UI redirect
- Real intent (confidence > GENERAL_QUERY) always breaks pending flow
- Zero LLM in all multi-step paths
- One param per turn (not a wall of questions)

**Why:** Original LLM Ava naturally handled missing params via GPT context. After the deterministic refactor, one-shot skill execution would fail when params were missing. This restores the conversational feel without reverting to LLM.
