// ═══════════════════════════════════════════════════════════════════════════
//  OmniTech Core — Event System Types
//  Single source of truth for all event definitions.
//
//  DESIGN PRINCIPLE:
//    Every important action in the system emits an OmniEvent.
//    Events are persisted to the `system_events` table and dispatched to
//    all in-process subscribers via the EventBus.
//
//  FUTURE EXTENSION (Big Data):
//    When Kafka is added, replace InternalEventBus with KafkaEventBus.
//    The IEventBus interface is the only contract — business logic never
//    changes. Events in system_events become the Kafka changelog table.
// ═══════════════════════════════════════════════════════════════════════════

// ── Module identifiers ────────────────────────────────────────────────────────

export type OmniModule =
  | "crm"
  | "sales"
  | "billing"
  | "marketing"
  | "ai"
  | "automations"
  | "analytics"
  | "whatsapp"
  | "telegram"
  | "calendar"
  | "documents"
  | "leads"
  | "ads"
  | "wiki"
  | "control_center"
  | "system";

// ── Event type catalogue ──────────────────────────────────────────────────────
// Convention: <module>.<entity>.<verb>
// Add new events here — never remove or rename existing ones (immutable log).

export type OmniEventType =
  // ── CRM ────────────────────────────────────────────────────────────────────
  | "crm.client.created"
  | "crm.client.updated"
  | "crm.client.deleted"
  | "crm.client.status_changed"

  // ── Sales ──────────────────────────────────────────────────────────────────
  | "sales.quote.created"
  | "sales.quote.sent"
  | "sales.quote.accepted"
  | "sales.quote.rejected"
  | "sales.quote.expired"

  // ── Billing ────────────────────────────────────────────────────────────────
  | "billing.invoice.created"
  | "billing.invoice.sent"
  | "billing.invoice.paid"
  | "billing.invoice.overdue"
  | "billing.invoice.cancelled"
  | "billing.payment.received"
  | "billing.recurring.generated"

  // ── Calendar ───────────────────────────────────────────────────────────────
  | "calendar.appointment.created"
  | "calendar.appointment.updated"
  | "calendar.appointment.cancelled"
  | "calendar.appointment.completed"

  // ── Messaging: WhatsApp ────────────────────────────────────────────────────
  | "whatsapp.message.received"
  | "whatsapp.message.sent"
  | "whatsapp.quote.accepted"
  | "whatsapp.automation.triggered"

  // ── Messaging: Telegram ────────────────────────────────────────────────────
  | "telegram.message.received"
  | "telegram.message.sent"
  | "telegram.appointment.created"

  // ── Documents ──────────────────────────────────────────────────────────────
  | "documents.file.uploaded"
  | "documents.file.deleted"
  | "documents.contract.signed"

  // ── AI ─────────────────────────────────────────────────────────────────────
  | "ai.chat.interaction"
  | "ai.content.generated"
  | "ai.tool.called"
  | "ai.memory.saved"
  | "ai.budget.alert"
  | "ai.budget.blocked"

  // ── Leads ──────────────────────────────────────────────────────────────────
  | "leads.lead.discovered"
  | "leads.lead.analyzed"
  | "leads.lead.converted"

  // ── Marketing ──────────────────────────────────────────────────────────────
  | "marketing.campaign.created"
  | "marketing.campaign.sent"
  | "marketing.campaign.completed"

  // ── Ads ────────────────────────────────────────────────────────────────────
  | "ads.campaign.created"
  | "ads.creative.generated"

  // ── Automations ────────────────────────────────────────────────────────────
  | "automations.task.created"
  | "automations.task.completed"
  | "automations.task.failed"
  | "automations.autopilot.executed"

  // ── Control Center ─────────────────────────────────────────────────────────
  | "control_center.workspace.created"
  | "control_center.user.invited"
  | "control_center.module.enabled"
  | "control_center.module.disabled"

  // ── System ─────────────────────────────────────────────────────────────────
  | "system.user.login"
  | "system.user.logout"
  | "system.import.completed"
  | "system.backup.completed"
  | "system.migration.applied";

// ── Event envelope ────────────────────────────────────────────────────────────

export interface OmniEvent<P = Record<string, unknown>> {
  /** Stable UUID — deduplication key for Kafka / idempotent consumers */
  id:        string;
  /** Structured type (module.entity.verb) */
  type:      OmniEventType;
  /** Workspace that generated the event */
  orgId:     number;
  /** Clerk user ID (null for system/scheduler events) */
  userId?:   string | null;
  /** Which module emitted this event */
  module:    OmniModule;
  /** Business payload — arbitrary JSON, kept small (<1 KB ideally) */
  payload:   P;
  /** UTC timestamp (JS Date) */
  timestamp: Date;
}

// ── EventBus contract (Kafka-ready interface) ─────────────────────────────────

export type EventHandler<P = Record<string, unknown>> = (event: OmniEvent<P>) => void | Promise<void>;

export interface IEventBus {
  /**
   * Publish an event.  Persists to system_events and notifies all local
   * subscribers.  On Kafka, this sends to the appropriate topic.
   */
  publish(event: OmniEvent): void | Promise<void>;

  /**
   * Subscribe to events of a given type.  Use "*" for all events.
   * On Kafka, this maps to a consumer group subscription.
   */
  subscribe(eventType: OmniEventType | "*", handler: EventHandler): void;

  /** Remove a previously registered handler. */
  unsubscribe(eventType: OmniEventType | "*", handler: EventHandler): void;
}

// ── Emit helper input (id + timestamp auto-generated) ────────────────────────

export type EmitInput<P = Record<string, unknown>> = Omit<OmniEvent<P>, "id" | "timestamp">;
