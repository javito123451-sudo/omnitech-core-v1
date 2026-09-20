import { Bot, Lock } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { AgentCard } from "@/components/agents/AgentCard";
import { ApiErrorAlert } from "@/components/agents/ApiErrorAlert";
import { CreateAgentDialog } from "@/components/agents/CreateAgentDialog";
import { CreditsSummary } from "@/components/agents/CreditsSummary";
import { defaultChannelsOf } from "@/lib/agents/format";
import {
  useAgentPermissions, useAgents, useCreditsBalance, useCreditsDashboard, useDefaultAgents,
} from "@/lib/agents/hooks";
import { useOrg } from "@/lib/orgContext";

function AgentsSkeleton() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="agents-loading" aria-busy="true">
      {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-36 rounded-xl" />)}
    </div>
  );
}

function AgentsContent({ canWrite }: { canWrite: boolean }) {
  const agents = useAgents();
  const balance = useCreditsBalance();
  const dashboard = useCreditsDashboard();
  const defaults = useDefaultAgents();

  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2"><Bot className="h-6 w-6 text-violet-400" /> Agentes</h1>
          <p className="text-sm text-muted-foreground mt-1">Gestiona tus agentes de IA, sus versiones y su consumo.</p>
        </div>
        {canWrite && <CreateAgentDialog />}
      </div>

      <CreditsSummary balance={balance} dashboard={dashboard} />

      {agents.isPending && <AgentsSkeleton />}

      {agents.isError && <ApiErrorAlert error={agents.error} onRetry={() => void agents.refetch()} />}

      {agents.isSuccess && agents.data.length === 0 && (
        <Empty className="border border-dashed border-border rounded-xl" data-testid="agents-empty">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Bot /></EmptyMedia>
            <EmptyTitle>Aún no tienes agentes</EmptyTitle>
            <EmptyDescription>
              {canWrite
                ? "Crea tu primer agente de IA. Empezará como borrador y podrás configurarlo antes de publicarlo."
                : "Todavía no hay agentes en este workspace. Pide a un administrador que cree el primero."}
            </EmptyDescription>
          </EmptyHeader>
          {canWrite && <EmptyContent><CreateAgentDialog /></EmptyContent>}
        </Empty>
      )}

      {agents.isSuccess && agents.data.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" data-testid="agents-list">
          {agents.data.map((a) => <AgentCard key={a.id} agent={a} defaultChannels={defaultChannelsOf(a.id, defaults.data)} />)}
        </div>
      )}
    </>
  );
}

export default function AgentsPage() {
  const { loading } = useOrg();
  const { canRead, canWrite } = useAgentPermissions();

  return (
    <div className="mx-auto w-full max-w-6xl space-y-6 p-4 sm:p-6">
      {loading ? (
        <AgentsSkeleton />
      ) : !canRead ? (
        <Alert data-testid="agents-no-access">
          <Lock className="h-4 w-4" />
          <AlertTitle>Sin acceso a los agentes</AlertTitle>
          <AlertDescription>Tu rol no tiene el permiso para ver los agentes de este workspace (agents.read). Contacta con tu administrador.</AlertDescription>
        </Alert>
      ) : (
        <AgentsContent canWrite={canWrite} />
      )}
    </div>
  );
}
