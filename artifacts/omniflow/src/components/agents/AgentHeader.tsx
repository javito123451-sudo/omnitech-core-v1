import type { ReactNode } from "react";
import { AgentStatusBadge } from "@/components/agents/AgentStatusBadge";
import { budgetSummary, formatDateTime } from "@/lib/agents/format";
import type { Agent, AgentVersion } from "@/lib/agents/types";

/** Cabecera del detalle: nombre, estado, versión activa, descripción y presupuesto. Las acciones llegan como `actions`. */
export function AgentHeader({ agent, versions, actions }: { agent: Agent; versions: AgentVersion[]; actions?: ReactNode }) {
  const active = versions.find((v) => v.id === agent.activeVersionId) ?? null;
  const budget = budgetSummary(agent);
  return (
    <div className="flex flex-wrap items-start justify-between gap-3" data-testid="agent-header">
      <div className="min-w-0 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-foreground break-words" data-testid="agent-name">{agent.name}</h1>
          <AgentStatusBadge status={agent.status} />
        </div>
        <p className="text-sm text-muted-foreground" data-testid="agent-description">{agent.description || "Sin descripción"}</p>
        <p className="text-xs text-muted-foreground" data-testid="agent-active-version">
          {active ? `Versión activa: v${active.versionNumber}` : "Sin versión activa"} · {budget ? `Presupuesto: ${budget}` : "Sin presupuesto propio"}
        </p>
        <p className="text-xs text-muted-foreground" data-testid="agent-updated">Actualizado: {formatDateTime(agent.updatedAt)}</p>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
