/**
 * Action Engine — Type Definitions
 *
 * The Action Engine is the execution layer of the intelligence pipeline.
 *
 * Architecture position:
 *   Modules → emitAieEvent() → AIE Bus → Dispatcher → Handlers → executeAction() → Action Engine → Modules
 *                                                                  (Phase 4+)
 *
 * Separation of concerns:
 *   - AIE handlers DECIDE what should happen (read context, detect anomalies).
 *   - The Action Engine EXECUTES those decisions (writes DB, sends notifications).
 *   - Modules provide the actual implementation of each action via registerAction().
 *
 * Principles:
 *   - Every action is identified by a namespaced string: "<domain>.<verb>"
 *   - Every action receives a typed payload specific to that action.
 *   - Action errors are caught and logged — they NEVER propagate to the handler.
 *   - Actions are fire-and-forget from the handler's perspective.
 *   - Each action execution is optionally logged to the audit trail.
 */

// ── Action payload ────────────────────────────────────────────────────────────

/** The context object every action executor receives alongside its payload. */
export interface ActionContext {
  /** Organization that owns this action — MANDATORY, isolation boundary */
  orgId:       number;

  /** Internal user ID who triggered the originating event (null = system-generated) */
  userId?:     number;

  /** Clerk user ID for cross-referencing with ACE */
  clerkUserId?: string;

  /** Event ID from the AIE event that triggered this action (for tracing) */
  sourceEventId?: string;

  /** Human-readable source label (e.g. "OmniTime:clock-in-handler") */
  source:      string;
}

// ── Executor function ─────────────────────────────────────────────────────────

/**
 * An action executor is a function that carries out a single, named operation.
 *
 * Rules for action implementations:
 *  1. Must be idempotent where possible (same payload = same outcome).
 *  2. Must filter by ctx.orgId before any DB query.
 *  3. Should throw on real errors — the executor wrapper catches and logs them.
 *  4. Should be fast — offload long-running work to a queue (Phase 5+).
 */
export type ActionExecutorFn<TPayload = Record<string, unknown>> = (
  payload: TPayload,
  ctx:     ActionContext,
) => Promise<void> | void;

// ── Action registration ───────────────────────────────────────────────────────

export interface ActionRegistration<TPayload = Record<string, unknown>> {
  /** Namespaced action name: "<domain>.<verb>" e.g. "notification.create" */
  name:        string;

  /** Human-readable description — used in diagnostics and admin UIs */
  description: string;

  /** The function that performs the action */
  executor:    ActionExecutorFn<TPayload>;

  /**
   * Whether this action should be recorded in the audit trail.
   * Default: false (set to true for actions that mutate visible data).
   */
  audit?: boolean;
}

// ── Execution result ──────────────────────────────────────────────────────────

export type ActionResultStatus = "ok" | "error" | "skipped" | "not_found";

export interface ActionResult {
  /** The action that was executed */
  actionName:   string;

  /** Execution status */
  status:       ActionResultStatus;

  /** Execution duration in milliseconds */
  durationMs:   number;

  /** Error message if status === "error" */
  error?:       string;

  /** Optional machine-readable output from the executor (for chaining) */
  output?:      Record<string, unknown>;
}

// ── IActionEngine interface ───────────────────────────────────────────────────

/**
 * The contract for the Action Engine.
 * All external code should use this interface, not the concrete class.
 */
export interface IActionEngine {
  /**
   * Register a new action type with its executor.
   * Overwrites existing registration if the name already exists.
   */
  register<TPayload = Record<string, unknown>>(
    registration: ActionRegistration<TPayload>,
  ): void;

  /**
   * Execute a registered action by name.
   * Always resolves (never rejects) — errors are captured in ActionResult.
   */
  execute(
    actionName: string,
    payload:    Record<string, unknown>,
    ctx:        ActionContext,
  ): Promise<ActionResult>;

  /**
   * Execute multiple actions in parallel for the same context.
   * Errors in individual actions do not affect others.
   */
  executeAll(
    actions: Array<{ name: string; payload: Record<string, unknown> }>,
    ctx:     ActionContext,
  ): Promise<ActionResult[]>;

  /** List all registered action names (for diagnostics) */
  listActions(): string[];

  /** Check if an action is registered */
  hasAction(name: string): boolean;
}

// ── Built-in action payload types ─────────────────────────────────────────────
// Each built-in action has its own strongly-typed payload interface.

export interface NotificationPayload {
  /** Internal user ID to notify */
  targetUserId:  number;
  title:         string;
  body:          string;
  /** Optional URL to navigate to when the notification is clicked */
  link?:         string;
  /** Severity level (affects colour/icon in the UI) */
  level?:        "info" | "warning" | "error" | "success";
}

export interface AuditLogPayload {
  action:        string;        // e.g. "TIME_INCIDENT_AUTO_CREATED"
  targetType?:   string;        // e.g. "time_entry"
  targetId?:     string | number;
  details?:      string;        // human-readable description
}

export interface AceUpdatePayload {
  /** Target user whose context to update */
  userId:        number;
  clerkUserId?:  string;
  /** Partial ACE context to merge in */
  contextPatch:  Record<string, unknown>;
}

export interface DebugLogPayload {
  message:       string;
  data?:         Record<string, unknown>;
}
