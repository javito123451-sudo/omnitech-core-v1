---
name: WhatsApp conversations decoupled from CRM
description: Architecture decision — WhatsApp conversations no longer require or create CRM client records.
---

## Rule
A WhatsApp message NEVER automatically creates a `clients` row, a lead, a contact, or any CRM record. The conversation pipeline works independently of the CRM.

## What changed (FIX-AG)
- `messages.client_id` made nullable (schema + `ALTER TABLE messages ALTER COLUMN client_id DROP NOT NULL`)
- `processIncomingMessage` in `whatsapp.ts` removed PASO 4 (auto-create block) and the abort-on-no-client guard
- `orgId` now sourced from `resolveOrgFromPhoneNumberId(phoneNumberId)` → `auditOrgId`, NOT from `client.orgId`
- `clientId` in messages INSERT is `client?.id ?? null`
- Lead Intelligence block, quote lookup, and acceptance/rejection path all gated on `if (client)` — only fire when a CRM client is already linked by phone match

## Why
- `clients.email NOT NULL` without a default caused every INSERT for unknown numbers to fail → entire pipeline aborted → bot only responded to numbers already in the DB (owner's number)
- Architectural requirement: conversations must be independent from CRM. CRM records created only by explicit action or business rule

## How to apply
- If a future feature needs to create a CRM record from a WhatsApp conversation, it must be an explicit action (manual agent conversion, a configured automation, or form submission) — never an implicit auto-create on message receipt
- `orgId` for the entire message flow = `auditOrgId` (from phone_number_id resolution), not `client.orgId`
- Anonymous messages (clientId=null) do NOT appear in the CRM conversations view (`conversationsHandler` skips null clientId naturally)
- Telegram channel still auto-creates clients (different architecture, not changed)

## Key files
- `artifacts/api-server/src/routes/whatsapp.ts` — `processIncomingMessage()`
- `lib/db/src/schema/messages.ts` — `clientId` nullable
- `artifacts/api-server/src/utils/startupMigrations.ts` — FIX-AG
