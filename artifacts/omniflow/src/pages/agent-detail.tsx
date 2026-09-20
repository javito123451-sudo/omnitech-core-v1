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
import { SimulationPanel } from "@/components/agents/SimulationPanel";
import { ApiErrorAlert } from "@/components/agents/ApiErrorAlert";
import { AgentsApiError } from "@/lib/agents/agentErrors";
import { useActiveWorkspaceId, useAgent, useAgentPermissions } from "@/lib/agents/hooks";
import type { AgentDetailResponse, AgentVersion } from "@/lib/agents/types";
import { useOrg } from "@/lib/orgContext";

function DetailView({ data }: { data: AgentDetailResponse }) {
  const { agent, versions } = data;
  const ws = useActiveWorkspaceId();
  const { canPublish, canWrite } = useAgentPermissions();
  const active = versions.find((v) => v.id === agent.activeVersionId) ?? null;
  const shown: AgentVersion | null = active ?? versions[0] ?? null;
  const hasDraft = versions.some((v) => v.publishedAt === null);
  const archived = agent.status === "archived";
  // El backend permite editar (siempre sobre un borrador) en draft, published y paused; archived responde 409.
  const canEdit = canWrite && !archived;

  return (
    <>
      <AgentHeader
        agent={agent}
        versions={versions}
        actions={canPublish && !archived && hasDraft ? <PublishAgentDialog agent={agent} /> : undefined}
      />
      {archived && canWrite && (
        <Alert data-testid="edit-unavailable"><AlertTitle>Edición no disponible</AlertTitle><AlertDescription>Un agente archivado no se puede modificar.</AlertDescription></Alert>
      )}

      <Tabs defaultValue="current" className="space-y-3">
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
            <AgentConfigForm key={`${ws}-${agent.id}`} agent={agent} versions={versions} />
          </TabsContent>
        )}
      </Tabs>

      <AgentVersionList agent={agent} versions={versions} shownVersionId={shown?.id ?? null} />

      {archived ? (
        <Alert data-testid="simulation-unavailable"><AlertTitle>Simulación no disponible</AlertTitle><AlertDescription>Un agente archivado no se puede simular.</AlertDescription></Alert>
      ) : (
        <SimulationPanel key={`${ws}-${agent.id}`} agentId={agent.id} />
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
