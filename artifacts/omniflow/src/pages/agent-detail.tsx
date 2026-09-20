import { useCallback, useState } from "react";
import { Link, useParams } from "wouter";
import { ArrowLeft, Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AgentConfigForm } from "@/components/agents/AgentConfigForm";
import { AgentConfigSummary } from "@/components/agents/AgentConfigSummary";
import { AgentHeader } from "@/components/agents/AgentHeader";
import { AgentVersionList } from "@/components/agents/AgentVersionList";
import { PublishAgentDialog } from "@/components/agents/PublishAgentDialog";
import { VersionDetailPanel } from "@/components/agents/VersionDetailPanel";
import { DraftCard, DraftReview, VersioningFlow, draftChangeCount } from "@/components/agents/VersioningFlow";
import { SimulationPanel } from "@/components/agents/SimulationPanel";
import { ApiErrorAlert } from "@/components/agents/ApiErrorAlert";
import { AgentsApiError } from "@/lib/agents/agentErrors";
import { useActiveWorkspaceId, useAgent, useAgentPermissions } from "@/lib/agents/hooks";
import { findActive, findDraft, findReviewBase, findSimulationTarget, simulationKey } from "@/lib/agents/versioning";
import type { AgentDetailResponse, AgentVersion } from "@/lib/agents/types";
import { useOrg } from "@/lib/orgContext";

function DetailView({ data }: { data: AgentDetailResponse }) {
  const { agent, versions } = data;
  const ws = useActiveWorkspaceId();
  const { canPublish, canWrite } = useAgentPermissions();
  const active = findActive(agent, versions);
  const shown: AgentVersion | null = active ?? versions[0] ?? null;
  const draft = findDraft(versions);
  const reviewBase = findReviewBase(agent, versions);
  const target = findSimulationTarget(agent, versions);
  const changes = draftChangeCount(reviewBase, draft);
  const archived = agent.status === "archived";
  // El backend permite editar (siempre sobre un borrador) en draft, published y paused; archived responde 409.
  const canEdit = canWrite && !archived;

  const [tab, setTab] = useState("current");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [formDirty, setFormDirty] = useState(false);
  const [simulationCurrent, setSimulationCurrent] = useState(false);
  // Sube cada vez que ESTA pantalla cambia el borrador (guardar, restaurar): invalida al instante cualquier simulación previa,
  // sin esperar a que el detalle se vuelva a cargar.
  const [epoch, setEpoch] = useState(0);
  const bumpEpoch = useCallback(() => setEpoch((n) => n + 1), []);

  const simKey = `${simulationKey(agent, target)}@${epoch}`;
  const targetLabel = !target ? "el agente" : target.id === draft?.id ? `el borrador v${target.versionNumber}` : target.id === active?.id ? `la versión activa v${target.versionNumber}` : `la versión v${target.versionNumber}`;

  function focusSimulation() {
    const el = document.getElementById("simulation-message");
    el?.scrollIntoView?.({ behavior: "smooth", block: "center" });
    el?.focus();
  }
  function openInHistory(id: number) {
    setSelectedId(id);
    document.getElementById("version-history")?.scrollIntoView?.({ behavior: "smooth", block: "start" });
  }

  return (
    <>
      <AgentHeader
        agent={agent}
        versions={versions}
        actions={canPublish && !archived && draft ? <PublishAgentDialog agent={agent} draft={draft} changes={changes} reviewBase={reviewBase} /> : undefined}
      />
      {archived && canWrite && (
        <Alert data-testid="edit-unavailable"><AlertTitle>Edición no disponible</AlertTitle><AlertDescription>Un agente archivado no se puede modificar.</AlertDescription></Alert>
      )}

      <VersioningFlow draft={archived ? null : draft} simulationCurrent={simulationCurrent} changes={changes} reviewBase={reviewBase} canPublish={canPublish} />
      {!archived && (
        <DraftCard draft={draft} canEdit={canEdit} onOpen={() => openInHistory(draft!.id)} onEdit={() => setTab("edit")} onSimulate={focusSimulation} />
      )}

      <Tabs value={tab} onValueChange={setTab} className="space-y-3">
        <TabsList data-testid="detail-tabs">
          <TabsTrigger value="current">Configuración actual</TabsTrigger>
          {canEdit && <TabsTrigger value="edit">Editar borrador</TabsTrigger>}
        </TabsList>

        <TabsContent value="current" className="space-y-4">
          {!canEdit && <p className="text-xs text-muted-foreground">Vista de solo lectura de la configuración.</p>}
          {shown ? (
            <>
              <p className="text-sm font-medium text-foreground" data-testid="config-title">
                Configuración · {active ? `versión activa v${shown.versionNumber}` : `última versión (${shown.publishedAt ? "publicada" : "borrador"}) v${shown.versionNumber}`}
              </p>
              <AgentConfigSummary config={shown.config} />
            </>
          ) : (
            <Alert><AlertTitle>Sin versiones</AlertTitle><AlertDescription>Este agente todavía no tiene ninguna versión.</AlertDescription></Alert>
          )}
        </TabsContent>

        {canEdit && (
          // forceMount: el formulario sigue montado al cambiar de pestaña, así no se pierden cambios sin guardar.
          <TabsContent value="edit" forceMount>
            <AgentConfigForm key={`${ws}-${agent.id}`} agent={agent} versions={versions} onDraftChanged={bumpEpoch} onDirtyChange={setFormDirty} />
          </TabsContent>
        )}
      </Tabs>

      {draft && !archived && <DraftReview draft={draft} base={reviewBase} />}

      <div id="version-history" className="space-y-4">
        <AgentVersionList agent={agent} versions={versions} shownVersionId={shown?.id ?? null} selectedId={selectedId} onSelect={setSelectedId} />
        {selectedId !== null && (
          <VersionDetailPanel
            agent={agent} versions={versions} selectedId={selectedId}
            canRestore={canEdit} hasUnsavedEdits={formDirty}
            onClose={() => setSelectedId(null)}
            onRestored={(saved) => { bumpEpoch(); setSelectedId(saved.id); }}
          />
        )}
      </div>

      {archived ? (
        <Alert data-testid="simulation-unavailable"><AlertTitle>Simulación no disponible</AlertTitle><AlertDescription>Un agente archivado no se puede simular.</AlertDescription></Alert>
      ) : (
        <SimulationPanel key={`${ws}-${agent.id}`} agentId={agent.id} simulationKey={simKey} targetLabel={targetLabel} onCurrentChange={setSimulationCurrent} />
      )}
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
