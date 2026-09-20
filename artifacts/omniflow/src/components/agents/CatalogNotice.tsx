import { AlertTriangle } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { describeAgentError } from "@/lib/agents/agentErrors";

/** Texto común para un valor guardado en la configuración que el catálogo actual no contiene. */
export const NOT_IN_CATALOG = "Configuración existente no disponible en el catálogo";

/**
 * Error de un catálogo, con el mensaje del sistema de errores de Agent Factory (401, 403, 404, 409, 422, 429, 5xx…) y su
 * código técnico visible. Es recuperable: «Reintentar» vuelve a pedir solo ese catálogo. El valor ya guardado en la
 * configuración no se toca.
 */
export function CatalogError({ name, error, onRetry }: { name: string; error: unknown; onRetry: () => void }) {
  const info = describeAgentError(error);
  return (
    <Alert variant="destructive" data-testid={`catalog-error-${name}`}>
      <AlertTriangle className="h-4 w-4" />
      <AlertTitle>{`No se pudo cargar el catálogo: ${info.title}`}</AlertTitle>
      <AlertDescription className="space-y-2">
        <p>{info.message}</p>
        <p className="text-xs font-mono opacity-70" data-testid={`catalog-error-technical-${name}`}>{info.technical}</p>
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>Reintentar</Button>
      </AlertDescription>
    </Alert>
  );
}

export function CatalogLoading({ name, label }: { name: string; label: string }) {
  return <p className="text-sm text-muted-foreground" data-testid={`catalog-loading-${name}`} aria-busy="true">{label}</p>;
}
