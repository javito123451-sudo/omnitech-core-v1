---
name: Ava deterministic routing
description: How the Ava web chat was refactored to zero-LLM dependency using the existing Intent Engine and Skill Engine.
---

# Ava deterministic routing (POST /api/chat)

## The rule
`POST /api/chat` (Ava web chat) routes ALL actions through:
1. `classifyIntentRegex(text)` — deterministic regex, no LLM
2. `intentToSkill(intent)` — maps Intent enum → skill ID
3. `executeSkill(skillId, params, orgId)` — runs Skill Engine
4. `formatSkillResponse(skillId, result, params)` — deterministic Markdown

**Why:** Eliminated 2 OpenAI GPT calls per Ava message (tool detection + streaming response) and memory extraction GPT call. Zero API cost for Ava interactions.

## How to apply
- When adding a new Ava capability: (a) add regex pattern to `intentEngine.ts` PATTERNS array, (b) add Intent → skill mapping to `intentToSkill()`, (c) add formatter to `avaFormatters.ts` `formatSkillResponse()` switch.
- Do NOT add GPT calls back into the POST /api/chat handler.
- WhatsApp (`telegram.ts`, `whatsapp.ts`) routes are separate and still use their own Intent Engine integration (unchanged).

## File locations
- Intent classification: `src/intents/intentEngine.ts` — `classifyIntentRegex()`, `intentToSkill()`
- Skill execution: `src/skills/index.ts` — `executeSkill()`
- Response formatters: `src/routes/avaFormatters.ts` — `formatSkillResponse()`, `formatExecutiveResponse()`, `buildGreetingResponse()`, `buildHelpResponse()`, `buildFallbackResponse()`
- POST handler: `src/routes/chat.ts` lines ~2112+ (new deterministic handler)

## Memory loading
Old: `getRelevantMemories(aiProvider, orgId, text)` — uses `aiProvider.embed()` (LLM)  
New: Direct DB query, `desc(agentMemoryTable.updatedAt) LIMIT 20` — no LLM needed

## Executive mode
Kept but LLM-free: 5 parallel `executeCrmTool()` calls (all deterministic DB queries) → `formatExecutiveResponse()` deterministic Markdown formatter.

## `client_name` param extractor
Added to CREATE_APPOINTMENT, RESCHEDULE_APPOINTMENT, CANCEL_APPOINTMENT in `intentEngine.ts`. Extracts "con [Name]" and "de [Name]" patterns.
