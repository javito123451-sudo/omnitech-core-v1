/**
 * AIE — Handler Registry
 *
 * This file is the single entry point for registering all AIE handlers.
 * It is called once during application startup (from aie/index.ts).
 *
 * How to add a new handler module (Phase 4+):
 *  1. Create the file: src/aie/handlers/<domain>Handler.ts
 *  2. Export a register() function from it.
 *  3. Import and call it here.
 *
 * Current state: Phase 1 — infrastructure only.
 * Handlers will be registered here in Phase 4 (OmniTime intelligence)
 * and Phase 6 (CRM, Marketing Hub, OmniTax handlers).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * TEMPLATE for a future handler file:
 *
 * // src/aie/handlers/timeHandler.ts
 * import { registerHandler }    from "../dispatcher";
 * import { EVENT_TYPES }        from "../eventRegistry";
 * import type { AieEvent }      from "../types";
 *
 * async function handleClockIn(event: AieEvent): Promise<void> {
 *   const { orgId, payload } = event;
 *   // 1. Get ACE context to understand full session state
 *   // 2. Detect anomalies (late, early, etc.)
 *   // 3. Delegate actions to the Action Engine
 * }
 *
 * export function register(): void {
 *   registerHandler(EVENT_TYPES.TIME_CLOCK_IN, handleClockIn, "OmniTime: clock-in detector");
 * }
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * Register all AIE handlers.
 * Called once by initAIE() in src/aie/index.ts.
 */
export function registerAllHandlers(): void {
  // Phase 1: No handlers registered yet — infrastructure only.
  // Phase 4+: Uncomment as handler modules are implemented.
  //
  // import { register as registerTimeHandlers }       from "./timeHandler";
  // import { register as registerCrmHandlers }        from "./crmHandler";
  // import { register as registerAccountingHandlers } from "./accountingHandler";
  // import { register as registerPlatformHandlers }   from "./controlCenterHandler";
  //
  // registerTimeHandlers();
  // registerCrmHandlers();
  // registerAccountingHandlers();
  // registerPlatformHandlers();

  console.log("[AIE Handlers] Phase 1 — no handlers registered yet (infrastructure only).");
}
