/**
 * AIE — Event Registry
 *
 * Authoritative catalog of all event types that can flow through the AIE.
 *
 * Purpose:
 *  - Single source of truth for event type strings (avoid magic strings).
 *  - IDE autocomplete and compile-time safety via EVENT_TYPES.
 *  - Self-documenting metadata for each event (payload shape, source, description).
 *  - Useful for diagnostics endpoints and future admin UIs.
 *
 * Rules:
 *  - Event types follow the pattern "<domain>.<past_tense_verb>".
 *  - Every module that emits events must register them here before using them.
 *  - Payload schema keys are documentation only — not runtime-validated here.
 */

import type { AieEventMeta } from "./types";

// ══════════════════════════════════════════════════════════════════════════════
//  EVENT TYPE CONSTANTS
//  Import these instead of hardcoding strings in modules.
// ══════════════════════════════════════════════════════════════════════════════

export const EVENT_TYPES = {
  // ── CRM ──────────────────────────────────────────────────────────────────
  CRM_CLIENT_CREATED:        "crm.client_created",
  CRM_CLIENT_UPDATED:        "crm.client_updated",
  CRM_CLIENT_STATUS_CHANGED: "crm.client_status_changed",
  CRM_CLIENT_DELETED:        "crm.client_deleted",
  CRM_DEAL_CREATED:          "crm.deal_created",
  CRM_DEAL_MOVED:            "crm.deal_moved",
  CRM_DEAL_CLOSED_WON:       "crm.deal_closed_won",
  CRM_DEAL_CLOSED_LOST:      "crm.deal_closed_lost",

  // ── Appointments ─────────────────────────────────────────────────────────
  APPOINTMENT_CREATED:       "crm.appointment_created",
  APPOINTMENT_UPDATED:       "crm.appointment_updated",
  APPOINTMENT_CANCELLED:     "crm.appointment_cancelled",
  APPOINTMENT_COMPLETED:     "crm.appointment_completed",
  APPOINTMENT_MISSED:        "crm.appointment_missed",

  // ── Quotes ───────────────────────────────────────────────────────────────
  QUOTE_CREATED:             "crm.quote_created",
  QUOTE_SENT:                "crm.quote_sent",
  QUOTE_ACCEPTED:            "crm.quote_accepted",
  QUOTE_REJECTED:            "crm.quote_rejected",
  QUOTE_EXPIRING:            "crm.quote_expiring",

  // ── Accounting ────────────────────────────────────────────────────────────
  INVOICE_CREATED:           "accounting.invoice_created",
  INVOICE_SENT:              "accounting.invoice_sent",
  INVOICE_PAID:              "accounting.invoice_paid",
  INVOICE_OVERDUE:           "accounting.invoice_overdue",
  PAYMENT_REGISTERED:        "accounting.payment_registered",
  EXPENSE_CREATED:           "accounting.expense_created",

  // ── OmniTime ──────────────────────────────────────────────────────────────
  TIME_CLOCK_IN:             "time.clock_in",
  TIME_CLOCK_OUT:            "time.clock_out",
  TIME_BREAK_STARTED:        "time.break_started",
  TIME_BREAK_ENDED:          "time.break_ended",
  TIME_OVERTIME_DETECTED:    "time.overtime_detected",
  TIME_MISSED_CLOCK_IN:      "time.missed_clock_in",
  TIME_MISSED_CLOCK_OUT:     "time.missed_clock_out",
  TIME_EXCESSIVE_HOURS:      "time.excessive_hours",
  TIME_OFF_REQUESTED:        "time.time_off_requested",
  TIME_OFF_APPROVED:         "time.time_off_approved",
  TIME_OFF_REJECTED:         "time.time_off_rejected",
  TIME_INCIDENT_CREATED:     "time.incident_created",
  TIME_SHIFT_ASSIGNED:       "time.shift_assigned",
  TIME_PATTERN_DETECTED:     "time.pattern_detected",

  // ── Marketing ─────────────────────────────────────────────────────────────
  CAMPAIGN_LAUNCHED:         "marketing.campaign_launched",
  CAMPAIGN_COMPLETED:        "marketing.campaign_completed",
  CAMPAIGN_FAILED:           "marketing.campaign_failed",

  // ── OmniTax ───────────────────────────────────────────────────────────────
  TAX_OBLIGATION_DUE:        "tax.obligation_due",
  TAX_DOCUMENT_UPLOADED:     "tax.document_uploaded",
  TAX_CALCULATION_READY:     "tax.calculation_ready",

  // ── Channels (WhatsApp / Telegram) ────────────────────────────────────────
  CHANNEL_MESSAGE_RECEIVED:  "channels.message_received",
  CHANNEL_MESSAGE_SENT:      "channels.message_sent",
  CHANNEL_ACCEPTANCE_DETECTED: "channels.acceptance_detected",

  // ── Portal Cliente ────────────────────────────────────────────────────────
  PORTAL_INVOICE_VIEWED:     "portal.invoice_viewed",
  PORTAL_PAYMENT_NOTIFIED:   "portal.payment_notified",

  // ── Autopilot ─────────────────────────────────────────────────────────────
  AUTOPILOT_TASK_EXECUTED:   "autopilot.task_executed",
  AUTOPILOT_TASK_FAILED:     "autopilot.task_failed",

  // ── Auth / Platform ───────────────────────────────────────────────────────
  AUTH_USER_LOGIN:           "auth.user_login",
  AUTH_SUPPORT_MODE_ENTERED: "auth.support_mode_entered",
  PLATFORM_WORKSPACE_CREATED: "platform.workspace_created",
  PLATFORM_MODULE_TOGGLED:   "platform.module_toggled",
  PLATFORM_USER_SUSPENDED:   "platform.user_suspended",
  PLATFORM_BACKUP_FAILED:    "platform.backup_failed",

  // ── Context (ACE-driven) ──────────────────────────────────────────────────
  CONTEXT_CLIENT_CHANGED:    "context.client_changed",
  CONTEXT_MODULE_CHANGED:    "context.module_changed",
  CONTEXT_WORKDAY_STARTED:   "context.workday_started",
  CONTEXT_WORKDAY_ENDED:     "context.workday_ended",
} as const;

export type AieEventType = typeof EVENT_TYPES[keyof typeof EVENT_TYPES];

// ══════════════════════════════════════════════════════════════════════════════
//  METADATA CATALOG
//  Documents the payload shape of every registered event.
// ══════════════════════════════════════════════════════════════════════════════

export const EVENT_CATALOG: AieEventMeta[] = [
  // ── CRM ──────────────────────────────────────────────────────────────────
  {
    type: EVENT_TYPES.CRM_CLIENT_CREATED,
    source: "crm",
    description: "A new client has been created in the CRM.",
    payloadSchema: { clientId: "number", clientName: "string", createdBy: "number" },
  },
  {
    type: EVENT_TYPES.CRM_CLIENT_STATUS_CHANGED,
    source: "crm",
    description: "A client's status changed (lead → active → inactive).",
    payloadSchema: { clientId: "number", fromStatus: "string", toStatus: "string" },
  },
  {
    type: EVENT_TYPES.CRM_DEAL_MOVED,
    source: "crm",
    description: "A deal was moved to a different pipeline stage.",
    payloadSchema: { dealId: "number", fromStageId: "number", toStageId: "number" },
  },

  // ── Appointments ─────────────────────────────────────────────────────────
  {
    type: EVENT_TYPES.APPOINTMENT_CREATED,
    source: "appointments",
    description: "A new appointment was scheduled.",
    payloadSchema: { appointmentId: "number", clientId: "number", startTime: "string", endTime: "string" },
  },
  {
    type: EVENT_TYPES.APPOINTMENT_CANCELLED,
    source: "appointments",
    description: "An appointment was cancelled.",
    payloadSchema: { appointmentId: "number", clientId: "number", reason: "string?" },
  },
  {
    type: EVENT_TYPES.APPOINTMENT_MISSED,
    source: "appointments",
    description: "An appointment passed without being completed.",
    payloadSchema: { appointmentId: "number", clientId: "number", scheduledAt: "string" },
  },

  // ── Accounting ────────────────────────────────────────────────────────────
  {
    type: EVENT_TYPES.INVOICE_PAID,
    source: "accounting",
    description: "An invoice was marked as paid.",
    payloadSchema: { invoiceId: "number", clientId: "number", amount: "number", currency: "string" },
  },
  {
    type: EVENT_TYPES.INVOICE_OVERDUE,
    source: "accounting",
    description: "An invoice has passed its due date without payment.",
    payloadSchema: { invoiceId: "number", clientId: "number", dueDate: "string", amount: "number" },
  },

  // ── OmniTime ──────────────────────────────────────────────────────────────
  {
    type: EVENT_TYPES.TIME_CLOCK_IN,
    source: "time",
    description: "An employee clocked in to start their workday.",
    payloadSchema: { entryId: "number", workerId: "number", clockInAt: "string", method: "string" },
  },
  {
    type: EVENT_TYPES.TIME_CLOCK_OUT,
    source: "time",
    description: "An employee clocked out.",
    payloadSchema: { entryId: "number", workerId: "number", clockOutAt: "string", totalMinutes: "number" },
  },
  {
    type: EVENT_TYPES.TIME_MISSED_CLOCK_IN,
    source: "time",
    description: "An employee was expected to clock in but did not.",
    payloadSchema: { workerId: "number", expectedAt: "string", shiftId: "number?" },
  },
  {
    type: EVENT_TYPES.TIME_OVERTIME_DETECTED,
    source: "time",
    description: "An employee has worked beyond their scheduled hours.",
    payloadSchema: { workerId: "number", entryId: "number", overtimeMinutes: "number" },
  },
  {
    type: EVENT_TYPES.TIME_INCIDENT_CREATED,
    source: "time",
    description: "A time-related incident was created (auto or manual).",
    payloadSchema: { incidentId: "number", workerId: "number", type: "string", autoDetected: "boolean" },
  },
  {
    type: EVENT_TYPES.TIME_PATTERN_DETECTED,
    source: "time",
    description: "Ava detected a recurring time behaviour pattern.",
    payloadSchema: { workerId: "number", patternType: "string", details: "object" },
  },

  // ── Auth / Platform ───────────────────────────────────────────────────────
  {
    type: EVENT_TYPES.AUTH_USER_LOGIN,
    source: "auth",
    description: "A user successfully authenticated.",
    payloadSchema: { clerkUserId: "string", ipAddress: "string?" },
  },
  {
    type: EVENT_TYPES.PLATFORM_MODULE_TOGGLED,
    source: "platform",
    description: "A module was enabled or disabled for a workspace.",
    payloadSchema: { moduleSlug: "string", enabled: "boolean", changedBy: "number" },
  },
  {
    type: EVENT_TYPES.PLATFORM_BACKUP_FAILED,
    source: "system",
    description: "The daily backup scheduler encountered an error.",
    payloadSchema: { error: "string" },
  },

  // ── Context ───────────────────────────────────────────────────────────────
  {
    type: EVENT_TYPES.CONTEXT_CLIENT_CHANGED,
    source: "crm",
    description: "The active client changed in the user's ACE context.",
    payloadSchema: { previousClientId: "number?", newClientId: "number", newClientName: "string" },
  },
];

// ── Lookup helpers ────────────────────────────────────────────────────────────

const _catalogMap = new Map<string, AieEventMeta>(
  EVENT_CATALOG.map(m => [m.type, m]),
);

export function getEventMeta(type: string): AieEventMeta | undefined {
  return _catalogMap.get(type);
}

export function isKnownEventType(type: string): boolean {
  return _catalogMap.has(type);
}

export function listEventTypes(): string[] {
  return [..._catalogMap.keys()];
}
