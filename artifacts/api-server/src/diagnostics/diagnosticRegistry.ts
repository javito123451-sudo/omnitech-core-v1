/**
 * Omni Diagnostics — Registry de DiagnosticAdapters
 * Cada módulo se registra automáticamente al importarse.
 */
import type { DiagnosticAdapter } from "./types";

const registry = new Map<string, DiagnosticAdapter>();

export const DiagnosticRegistry = {
  register(adapter: DiagnosticAdapter): void {
    if (registry.has(adapter.name)) {
      console.warn(`[Diagnostics] Adapter "${adapter.name}" already registered, overwriting`);
    }
    registry.set(adapter.name, adapter);
    console.log(`[Diagnostics] Adapter registered: ${adapter.name}`);
  },

  get(name: string): DiagnosticAdapter | undefined {
    return registry.get(name);
  },

  has(name: string): boolean {
    return registry.has(name);
  },

  list(): string[] {
    return Array.from(registry.keys()).sort((a, b) => {
      const pa = registry.get(a)?.priority ?? 100;
      const pb = registry.get(b)?.priority ?? 100;
      return pa - pb;
    });
  },

  getAll(): DiagnosticAdapter[] {
    return this.list().map((n) => registry.get(n)!).filter(Boolean);
  },
};
