import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { getAgentStatusDef } from "@/lib/agents/agentStatus";

export function AgentStatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const def = getAgentStatusDef(status);
  return (
    <Badge variant="outline" title={def.hint} data-status={def.id} className={cn("font-medium", def.color, className)}>
      {def.label}
    </Badge>
  );
}
