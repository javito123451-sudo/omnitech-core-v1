// ═══════════════════════════════════════════════════════════════════════════
//  AVA CORE — ACE bridge
//  Reads the existing Ava Context Engine (ace/index.ts) to give the model
//  richer situational context than the old `{ page: moduleLabel }` the
//  floating widget used to send. Read-only — Ava never writes to ACE itself
//  in this phase, so it can't corrupt what the frontend panel maintains.
// ═══════════════════════════════════════════════════════════════════════════

import { getCurrentContext } from "../ace";
import type { AvaContext } from "./types";

export function buildAceSummary(ctx: AvaContext): string {
  const view = getCurrentContext(ctx.orgId, ctx.userId);
  if (!view) return "Sin contexto de sesión ACE disponible (usuario sin actividad reciente registrada).";

  const parts: string[] = [
    `Página actual: ${view.activePage}`,
    view.activeModule ? `Módulo activo: ${view.activeModule}` : null,
    view.activeClient ? `Cliente activo: ${view.activeClient.name} (id ${view.activeClient.id})` : null,
    view.activeConversation ? `Conversación activa: id ${view.activeConversation.id}` : null,
    view.activeQuote ? `Presupuesto activo: id ${view.activeQuote.id}` : null,
    view.activeWorkday ? `Jornada OmniTime en curso (estado: ${view.clockStatus ?? "desconocido"})` : null,
    `Inactivo desde hace ${view.inactiveFor}s`,
  ].filter((p): p is string => !!p);

  return parts.join("\n");
}
