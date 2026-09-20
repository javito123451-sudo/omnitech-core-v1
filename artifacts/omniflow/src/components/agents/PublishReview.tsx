import type { UseQueryResult } from "@tanstack/react-query";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { EffectiveToolAccessPanel } from "@/components/agents/EffectiveToolAccessPanel";
import { NOT_AVAILABLE_NOW, deniedByAccess, type PublishBlocker } from "@/lib/agents/publishReadiness";
import { AgentStatusBadge } from "@/components/agents/AgentStatusBadge";
import { budgetSummary, channelLabel } from "@/lib/agents/format";
import type {
  Agent, AgentKnowledgeCatalogItem, AgentModelCatalog, AgentToolCatalogItem, AgentVersion, EffectiveAccessResponse,
} from "@/lib/agents/types";

const dash = (v: string | null | undefined) => (v && v.trim() ? v : "—");
const clip = (v: string | null | undefined, n = 240) => { const t = dash(v); return t.length > n ? `${t.slice(0, n)}…` : t; };

function Row({ label, testId, children }: { label: string; testId: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[10rem_1fr]" data-testid={testId}>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground break-words">{children}</dd>
    </div>
  );
}

/**
 * Revisión completa antes de publicar: qué es el agente, con qué modelo, conocimiento y herramientas, qué podría hacer
 * realmente para ti y qué presupuesto tiene. Sin claves, sin precios y sin el contenido de los documentos (solo títulos).
 */
export function PublishReview({ agent, draft, models, knowledge, tools, access, blockers }: {
  agent: Pick<Agent, "name" | "status" | "monthlyCreditLimit" | "dailyCreditLimit" | "perExecutionCreditLimit">;
  draft: AgentVersion;
  models: UseQueryResult<AgentModelCatalog>;
  knowledge: UseQueryResult<AgentKnowledgeCatalogItem[]>;
  tools: UseQueryResult<AgentToolCatalogItem[]>;
  access: UseQueryResult<EffectiveAccessResponse>;
  /** null = todavía no se puede comprobar (falta algún catálogo). */
  blockers: PublishBlocker[] | null;
}) {
  const c = draft.config;
  const titles = new Map((knowledge.data ?? []).map((k) => [k.id, k.title]));
  const toolNames = new Map((tools.data ?? []).map((t) => [t.id, t.name]));
  const modelChoice = (m: { provider?: string; model?: string }) => (m.provider || m.model ? `${m.provider || "—"} / ${m.model || "—"}` : "Predeterminado del sistema");
  const denied = access.data ? deniedByAccess(access.data) : [];

  return (
    <div className="space-y-4" data-testid="publish-review">
      <dl className="space-y-2 rounded-lg border border-border p-3">
        <Row label="Identidad" testId="review-identity">{dash(c.identity?.role)}</Row>
        <Row label="Objetivo" testId="review-objective">{clip(c.objective?.what)}{c.objective?.audience ? ` · Audiencia: ${c.objective.audience}` : ""}</Row>
        <Row label="Personalidad" testId="review-personality">{[c.personality?.tone, c.personality?.style, c.personality?.language, c.personality?.formality].filter(Boolean).join(" · ") || "—"}</Row>
        <Row label="Comportamiento" testId="review-behavior">{clip(c.behavior?.instructions)}{(c.behavior?.rules?.length ?? 0) > 0 ? ` (${c.behavior.rules.length} reglas)` : ""}</Row>
        <Row label="Empresa y contexto" testId="review-context">{clip(c.businessContext)}</Row>
        <Row label="Modelo" testId="review-model">{modelChoice(c.model ?? {})}</Row>
        <Row label="Modelos de respaldo" testId="review-fallbacks">
          {(c.model?.fallbacks ?? []).length === 0 ? "Ninguno" : (c.model.fallbacks ?? []).map((f, i) => <span key={i} className="mr-2 inline-block">{modelChoice(f)}</span>)}
        </Row>
        <Row label="Conocimiento" testId="review-knowledge">
          {c.knowledge?.workspace ? "Todo el conocimiento activo del workspace" : c.knowledge?.entryIds?.length ? c.knowledge.entryIds.map((id) => titles.get(id) ?? `#${id}`).join(", ") : "Ninguna entrada"}
        </Row>
        <Row label="Herramientas declaradas" testId="review-tools">
          {[...(c.tools?.read ?? []), ...(c.tools?.write ?? [])].length === 0 ? "Ninguna" : [...(c.tools?.read ?? []).map((id) => ({ id, k: "lectura" })), ...(c.tools?.write ?? []).map((id) => ({ id, k: "acción" }))].map(({ id, k }) => <span key={`${k}-${id}`} className="mr-2 inline-block">{toolNames.get(id) ?? id} ({k})</span>)}
        </Row>
        <Row label="Canales" testId="review-channels">{c.channels?.length ? c.channels.map(channelLabel).join(", ") : "Ninguno"}</Row>
        <Row label="Presupuesto" testId="review-budgets">{budgetSummary(agent) ?? "Sin presupuesto propio"}</Row>
        <Row label="Versión" testId="review-version">v{draft.versionNumber} (borrador, sin publicar)</Row>
        <Row label="Estado actual" testId="review-status"><AgentStatusBadge status={agent.status} /></Row>
      </dl>

      <EffectiveToolAccessPanel access={access} catalog={tools} />

      {denied.length > 0 && (
        <p className="text-xs text-amber-400" data-testid="review-denied-note">
          Con tu rol no podrías usar: {denied.map((d) => d.toolId).join(", ")}. No impide publicar: depende de quién use el agente.
        </p>
      )}

      {blockers && blockers.length > 0 && (
        <Alert variant="destructive" data-testid="publish-blockers">
          <AlertTitle>No se puede publicar todavía</AlertTitle>
          <AlertDescription className="space-y-1">
            <p>{NOT_AVAILABLE_NOW} o no válida. Corrígelo en el editor antes de publicar; no se cambia nada automáticamente.</p>
            <ul className="list-disc pl-5 text-xs">
              {blockers.map((b) => <li key={b.key} data-testid={`blocker-${b.key}`}><span className="font-medium">{b.label}</span>: {b.detail}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
