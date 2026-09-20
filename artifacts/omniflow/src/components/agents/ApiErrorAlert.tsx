import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeAgentError, type AgentErrorInfo } from "@/lib/agents/agentErrors";

/**
 * Muestra un error de la API de agentes con un mensaje comprensible Y su código técnico (nunca se oculta):
 * "Código: INSUFFICIENT_CREDITS · HTTP 402 · ID: …".
 */
export function ApiErrorAlert({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const info: AgentErrorInfo = describeAgentError(error);
  return (
    <Alert variant="destructive" role="alert" data-error-kind={info.kind}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{info.title}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{info.message}</p>
        {info.detail && <p className="text-xs opacity-80">{info.detail}</p>}
        <p className="text-xs font-mono opacity-70" data-testid="error-technical">{info.technical}</p>
        {onRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            Reintentar
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}
