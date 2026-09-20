import { Link } from "wouter";
import { Bot, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { AgentStatusBadge } from "@/components/agents/AgentStatusBadge";
import { budgetSummary, channelLabel, formatDateTime } from "@/lib/agents/format";
import type { AgentListItem } from "@/lib/agents/types";

/**
 * Tarjeta de un agente en la lista. Solo muestra lo que devuelve GET /api/agents: los canales de cada agente
 * viven dentro de la configuración de sus versiones (se ven en el detalle), no en la lista.
 */
export function AgentCard({ agent, defaultChannels }: { agent: AgentListItem; defaultChannels: string[] }) {
  const budget = budgetSummary(agent);
  return (
    <Link href={`/agents/${agent.id}`} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl" data-testid={`agent-card-${agent.id}`}>
      <Card className="h-full transition-colors hover:border-primary/40">
        <CardContent className="p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="h-10 w-10 shrink-0 rounded-xl bg-violet-500/10 border border-violet-500/20 flex items-center justify-center overflow-hidden">
              {agent.avatarUrl ? <img src={agent.avatarUrl} alt="" className="h-full w-full object-cover" /> : <Bot className="h-5 w-5 text-violet-400" />}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-semibold text-foreground truncate">{agent.name}</h3>
                <AgentStatusBadge status={agent.status} />
              </div>
              <p className="mt-1 text-sm text-muted-foreground line-clamp-2">{agent.description || "Sin descripción"}</p>
            </div>
          </div>

          <dl className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <div>
              <dt className="sr-only">Versión activa</dt>
              <dd data-testid={`agent-version-${agent.id}`}>
                {agent.activeVersionNumber !== null ? `Versión activa v${agent.activeVersionNumber}` : "Sin versión activa"}
              </dd>
            </div>
            <div>
              <dt className="sr-only">Presupuesto</dt>
              <dd data-testid={`agent-budget-${agent.id}`}>{budget ? `Presupuesto: ${budget}` : "Sin presupuesto propio"}</dd>
            </div>
            <div>
              <dt className="sr-only">Última actualización</dt>
              <dd data-testid={`agent-updated-${agent.id}`}>Actualizado {formatDateTime(agent.updatedAt)}</dd>
            </div>
          </dl>

          {defaultChannels.length > 0 && (
            <div className="flex flex-wrap gap-1.5" data-testid={`agent-default-${agent.id}`}>
              {defaultChannels.map((c) => (
                <Badge key={c} variant="outline" className="gap-1 border-amber-500/30 bg-amber-500/10 text-amber-400">
                  <Star className="h-3 w-3" /> Por defecto · {channelLabel(c)}
                </Badge>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}
