---
name: Telegram CRM intent audit rules
description: CRM-001/002/003 guard rules in telegram.ts preventing junk contacts and phantom appointments.
---

## CRM-LEAD-001/002/003/004 — Gated lead creation (implemented after CRM-001)

**Root cause of bug:** `GREETING_ONLY_RE` only filtered pure greetings. Substantive informational messages ("necesito saber qué servicio ofrecéis", "Transformación digital") bypassed the filter and auto-created junk leads.

**Three-way decision in auto-create block:**
1. `isGreetingOnly || isCommandMsg` → CRM-001: static welcome, no lead
2. `isTransactionalIntent || hasContactData` → CRM-LEAD-003/002: create lead
3. else (informational) → CRM-LEAD-004: anonymous AI reply, no lead

**`TRANSACTIONAL_INTENT_RE`** covers: cita, reunión, reservar, agendar, presupuesto, precio, contratar, demo, llamada, contactar, quiero empezar, me interesa contratar.

**`COMMAND_RE`** covers: `/start`, `/help`, etc. — bot commands never create leads.

**Anonymous AI path:** `client = null`, AI responds without history. No messages saved to DB. When user later expresses transactional intent → new message matches TRANSACTIONAL_INTENT_RE → lead created then.

## CRM-001 — No auto-create from greeting-only messages

**Rule:** `GREETING_ONLY_RE` constant + `hasValidContactData()` helper (near top of telegram.ts).
If `GREETING_ONLY_RE.test(trimmed) && !hasValidContactData(text)` → skip auto-create → send static welcome.

**Why:** Clients #246 and #247 were created from bare "Hola" messages — zero CRM value contacts.

**How to apply:**
- `isGreetingOnly` is computed before the auto-create block.
- Static welcome is sent after token fetch in the `!isAccepted && !isRejected` branch, before the AI call.
- Any substantive message (not matched by GREETING_ONLY_RE, or contains phone/email) auto-creates normally.

## CRM-002 — Block appointment creation for unidentified contacts

**Rule:** System prompt NUEVA CITA instruction split into two branches:
- "Si hay bloque CLIENTE IDENTIFICADO: en este prompt → llama create_appointment DIRECTAMENTE"
- "CRM-002 (solo si NO hay bloque CLIENTE IDENTIFICADO:) → pide nombre y contacto primero"

**Why:** A vague rule ("si el cliente no está identificado") caused the AI to ask for phone/email even for existing clients (e.g. Francisco #246 with 20 msg history). The wording must reference the exact context block label.

**Critical gotcha:** The system prompt condition MUST name the exact string "CLIENTE IDENTIFICADO:" that appears in the clientBlock template. Any other phrasing is misinterpreted by the AI.

## CRM-003 — DB readback validation in create_appointment

**Rule:** After `db.insert(appointmentsTable).returning()`:
1. Null-check the returned `appointment` — return error JSON if missing.
2. Re-read from DB: `db.select().from(appointmentsTable).where(and(eq(id, appointment.id), eq(orgId, ...)))`.
3. Validate `|startTime difference| <= 60_000 ms` — return error JSON if mismatch.

**Why:** Insert returning() can succeed silently in edge cases; re-read guarantees the displayed time matches persisted data.

**How to apply:** System prompt REGLA DE VALIDACIÓN says "SOLO confirma éxito si tool devuelve success:true Y verified:true". The create_appointment executor already returns `verified: true` on the success path.
