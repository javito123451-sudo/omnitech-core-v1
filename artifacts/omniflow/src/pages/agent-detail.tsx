import type { ReactNode } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentStatusBadge } from "@/components/agents/AgentStatusBadge";
import { ApiErrorAlert } from "@/components/agents/ApiErrorAlert";
import { AgentsApiError } from "@/lib/agents/agentErrors";
import { budgetSummary, channelLabel, formatDateTime } from "@/lib/agents/format";
import { useAgent, useAgentPermissions } from "@/lib/agents/hooks";
import type { AgentConfig, AgentDetailResponse, AgentVersion } from "@/lib/agents/types";
import { useOrg } from "@/lib/orgContext";

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground whitespace-pre-wrap break-words">{children}</dd>
    </div>
  );
}

const text = (v: string | null | undefined) => (v && v.trim() ? v : "—");

function Chips({ items, empty = "—" }: { items: string[] | undefined; empty?: string }) {
  if (!items || items.length === 0) return <span className="text-muted-foreground">{empty}</span>;
  return <span className="flex flex-wrap gap-1.5">{items.map((i) => <Badge key={i} variant="outline">{i}</Badge>)}</span>;
}

function Section({ title, children, testId }: { title: string; children: ReactNode; testId: string }) {
  return (
    <Card data-testid={testId}>
      <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">{title}</CardTitle></CardHeader>
      <CardContent><dl className="grid gap-3 sm:grid-cols-2">{children}</dl></CardContent>
    </Card>
  );
}

/** Configuración de una versión en solo lectura: exactamente los campos que guarda el backend. */
function ConfigView({ cfg }: { cfg: AgentConfig }) {
  return (
    <div className="space-y-4">
      <Section title="Identidad y objetivo" testId="cfg-identity">
        <Field label="Rol">{text(cfg.identity?.role)}</Field>
        <Field label="Qué hace">{text(cfg.objective?.what)}</Field>
        <Field label="Audiencia">{text(cfg.objective?.audience)}</Field>
        <Field label="Resultado esperado">{text(cfg.objective?.expectedOutcome)}</Field>
      </Section>
      <Section title="Personalidad" testId="cfg-personality">
        <Field label="Tono">{text(cfg.personality?.tone)}</Field>
        <Field label="Estilo">{text(cfg.personality?.style)}</Field>
        <Field label="Idioma">{text(cfg.personality?.language)}</Field>
        <Field label="Formalidad">{text(cfg.personality?.formality)}</Field>
      </Section>
      <Section title="Comportamiento" testId="cfg-behavior">
        <Field label="Instrucciones">{text(cfg.behavior?.instructions)}</Field>
        <Field label="Contexto del negocio">{text(cfg.businessContext)}</Field>
        <Field label="Reglas"><Chips items={cfg.behavior?.rules} /></Field>
        <Field label="Restricciones"><Chips items={cfg.behavior?.restrictions} /></Field>
        <Field label="Evitar"><Chips items={cfg.behavior?.avoid} /></Field>
      </Section>
      <Section title="Modelo y parámetros" testId="cfg-model">
        <Field label="Proveedor">{text(cfg.model?.provider)}</Field>
        <Field label="Modelo">{text(cfg.model?.model)}</Field>
        <Field label="Temperatura">{String(cfg.parameters?.temperature ?? "—")}</Field>
        <Field label="Tokens máx. de salida">{String(cfg.parameters?.maxOutputTokens ?? "—")}</Field>
        <Field label="Rondas de herramientas">{String(cfg.parameters?.maxToolRounds ?? "—")}</Field>
        <Field label="Mensajes de historial">{String(cfg.parameters?.maxHistoryMessages ?? "—")}</Field>
      </Section>
      <Section title="Conocimiento, herramientas y permisos" testId="cfg-tools">
        <Field label="Conocimiento del workspace">{cfg.knowledge?.workspace ? "Todo el conocimiento activo" : "Solo entradas seleccionadas"}</Field>
        <Field label="Categorías"><Chips items={cfg.knowledge?.categories} /></Field>
        <Field label="Herramientas de lectura"><Chips items={cfg.tools?.read} /></Field>
        <Field label="Herramientas de acción"><Chips items={cfg.tools?.write} /></Field>
        <Field label="Las acciones piden confirmación">{cfg.permissions?.writesRequireConfirmation === false ? "No" : "Sí"}</Field>
      </Section>
      <Section title="Canales" testId="cfg-channels">
        <Field label="Canales"><Chips items={cfg.channels?.map(channelLabel)} empty="Ninguno" /></Field>
      </Section>
    </div>
  );
}

function DetailView({ data }: { data: AgentDetailResponse }) {
  const { agent, versions } = data;
  const active = versions.find((v) => v.id === agent.activeVersionId) ?? null;
  const shown: AgentVersion | null = active ?? versions[0] ?? null;
  const budget = budgetSummary(agent);

  return (
    <>
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-bold text-foreground" data-testid="agent-name">{agent.name}</h1>
          <AgentStatusBadge status={agent.status} />
        </div>
        <p className="text-sm text-muted-foreground">{agent.description || "Sin descripción"}</p>
        <p className="text-xs text-muted-foreground" data-testid="agent-active-version">
          {active ? `Versión activa: v${active.versionNumber}` : "Sin versión activa"} · {budget ? `Presupuesto: ${budget}` : "Sin presupuesto propio"}
        </p>
        <p className="text-xs text-muted-foreground">Vista de solo lectura.</p>
      </div>

      {shown ? (
        <>
          <p className="text-sm font-medium text-foreground" data-testid="config-title">
            Configuración · {active ? `versión activa v${shown.versionNumber}` : `última versión (${shown.publishedAt ? "publicada" : "borrador"}) v${shown.versionNumber}`}
          </p>
          <ConfigView cfg={shown.config} />
        </>
      ) : (
        <Alert><AlertTitle>Sin versiones</AlertTitle><AlertDescription>Este agente todavía no tiene ninguna versión.</AlertDescription></Alert>
      )}

      <Card data-testid="versions">
        <CardHeader className="pb-2"><CardTitle className="text-sm font-semibold">Versiones ({versions.length})</CardTitle></CardHeader>
        <CardContent>
          <ul className="divide-y divide-border">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm" data-testid={`version-${v.versionNumber}`}>
                <span className="font-semibold">v{v.versionNumber}</span>
                <Badge variant="outline">{v.publishedAt ? "Publicada" : "Borrador"}</Badge>
                {v.id === agent.activeVersionId && <Badge className="bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">Activa</Badge>}
                <span className="text-xs text-muted-foreground">{formatDateTime(v.publishedAt ?? v.createdAt)}</span>
                {v.notes && <span className="text-xs text-muted-foreground truncate">{v.notes}</span>}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </>
  );
}

function AgentDetailContent({ agentId }: { agentId: number | null }) {
  const agent = useAgent(agentId);

  if (agentId === null) {
    return <ApiErrorAlert error={new AgentsApiError({ status: 400, code: null, message: "El identificador del agente no es válido." })} />;
  }
  if (agent.isPending) {
    return (
      <div className="space-y-4" data-testid="agent-loading" aria-busy="true">
        <Skeleton className="h-8 w-64" /><Skeleton className="h-4 w-96 max-w-full" /><Skeleton className="h-40 rounded-xl" />
      </div>
    );
  }
  if (agent.isError) return <ApiErrorAlert error={agent.error} onRetry={() => void agent.refetch()} />;
  return <DetailView data={agent.data} />;
}

export default function AgentDetailPage() {
  const { loading } = useOrg();
  const { canRead } = useAgentPermissions();
  const params = useParams<{ id: string }>();
  const parsed = Number(params.id);
  const agentId = Number.isInteger(parsed) && parsed > 0 ? parsed : null;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 p-4 sm:p-6">
      <Link href="/agents" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Agentes
      </Link>
      {loading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : !canRead ? (
        <Alert data-testid="agents-no-access">
          <Lock className="h-4 w-4" />
          <AlertTitle>Sin acceso a los agentes</AlertTitle>
          <AlertDescription>Tu rol no tiene el permiso para ver los agentes de este workspace (agents.read).</AlertDescription>
        </Alert>
      ) : (
        <AgentDetailContent agentId={agentId} />
      )}
    </div>
  );
}
