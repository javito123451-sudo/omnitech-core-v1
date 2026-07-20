/**
 * Action Engine — Registry
 *
 * Central store of all registered action executors.
 *
 * The registry is a simple Map<string, ActionRegistration>.
 * Modules call registerAction() at startup to make their actions available.
 * The executor calls getAction() at runtime to look up and invoke them.
 *
 * Thread safety: Node.js is single-threaded, so Map access is safe.
 */

import type { ActionRegistration } from "./types";

// ── Internal store ────────────────────────────────────────────────────────────

const _actions = new Map<string, ActionRegistration>();

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Register an action executor.
 * If an action with the same name already exists, it is replaced and a warning
 * is logged (unintentional double-registration should surface immediately).
 */
export function registerAction<TPayload = Record<string, unknown>>(
  registration: ActionRegistration<TPayload>,
): void {
  const { name } = registration;

  if (!name || !name.includes(".")) {
    console.warn(
      `[ActionEngine Registry] Invalid action name "${name}". ` +
      "Names must follow the pattern \"<domain>.<verb>\" e.g. \"notification.create\".",
    );
  }

  if (_actions.has(name)) {
    console.warn(
      `[ActionEngine Registry] Action "${name}" is already registered — overwriting. ` +
      "This may indicate a double-import or naming collision.",
    );
  }

  _actions.set(name, registration as unknown as ActionRegistration);

  console.log(`[ActionEngine Registry] Action registered: "${name}" — ${registration.description}`);
}

export function getAction(name: string): ActionRegistration | undefined {
  return _actions.get(name);
}

export function hasAction(name: string): boolean {
  return _actions.has(name);
}

export function listActions(): string[] {
  return [..._actions.keys()].sort();
}

export function getActionCount(): number {
  return _actions.size;
}

/**
 * Returns a diagnostic summary of all registered actions.
 */
export function getRegistrySummary(): Array<{
  name:        string;
  description: string;
  audit:       boolean;
}> {
  return [..._actions.entries()].map(([name, reg]) => ({
    name,
    description: reg.description,
    audit:       reg.audit ?? false,
  }));
}
