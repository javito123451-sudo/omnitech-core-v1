// Errores de Agent Factory: del cuerpo/HTTP que devuelve el backend a algo que el usuario entiende, SIN ocultar
// el código técnico (siempre se muestra junto al mensaje).
//
// Cubre los errores estructurados que el backend ya devuelve (ai-gateway/apiErrors.ts):
//   402  INSUFFICIENT_CREDITS · CREDIT_LIMIT_REACHED · AGENT_CREDIT_LIMIT_REACHED
//   409  DUPLICATE_REQUEST · REFERENCE_CONFLICT
//   429  BUDGET_BLOCKED
//   503  PROVIDER_UNAVAILABLE
// y los generales de la API (permission_denied, module_disabled, 404 de agente, validación…).
// Ninguno de los estructurados significa que se haya cobrado algo.

export type AgentErrorKind =
  | "credits" | "limit" | "duplicate" | "reference" | "budget" | "provider"
  | "permission" | "module" | "not_found" | "validation" | "conflict" | "auth" | "network" | "server" | "unknown";

export interface AgentErrorInput {
  status:     number | null;
  code:       string | null;
  message:    string | null;
  requestId?: string | null;
}

export interface AgentErrorInfo {
  status:    number | null;
  code:      string | null;
  requestId: string | null;
  kind:      AgentErrorKind;
  title:     string;
  /** Mensaje comprensible para el usuario. */
  message:   string;
  /** Mensaje original del backend, si aporta algo distinto (p. ej. "disponibles 4, se necesitan ~6"). */
  detail:    string | null;
  /** Línea técnica siempre visible: "Código: X · HTTP nnn · ID: …". */
  technical: string;
  retryable: boolean;
}

/** Error lanzado por el cliente HTTP con lo que el backend devolvió. */
export class AgentsApiError extends Error {
  readonly status:    number | null;
  readonly code:      string | null;
  readonly requestId: string | null;
  readonly body:      unknown;
  constructor(input: AgentErrorInput & { body?: unknown }) {
    super(input.message ?? (input.status ? `HTTP ${input.status}` : "Error de red"));
    this.name = "AgentsApiError";
    this.status = input.status;
    this.code = input.code;
    this.requestId = input.requestId ?? null;
    this.body = input.body;
  }
}

interface Known { kind: AgentErrorKind; title: string; message: string; retryable?: boolean }

const BY_CODE: Record<string, Known> = {
  INSUFFICIENT_CREDITS: {
    kind: "credits", title: "Créditos insuficientes",
    message: "No hay créditos suficientes para esta operación. No se ha cobrado nada. Añade créditos o espera a la renovación de tu plan.",
  },
  CREDIT_LIMIT_REACHED: {
    kind: "limit", title: "Límite de créditos alcanzado",
    message: "Has alcanzado el límite de créditos de tu plan (diario o mensual). No se ha cobrado nada; podrás volver a usarlos cuando se renueve el periodo.",
  },
  AGENT_CREDIT_LIMIT_REACHED: {
    kind: "limit", title: "Presupuesto del agente agotado",
    message: "Este agente ha alcanzado su presupuesto de créditos (mensual, diario o por ejecución). No se ha cobrado nada. Puedes ajustar su presupuesto o esperar al siguiente periodo.",
  },
  DUPLICATE_REQUEST: {
    kind: "duplicate", title: "Petición duplicada",
    message: "Esta petición ya se procesó o sigue en curso, así que no se ha repetido ni cobrado dos veces.",
  },
  REFERENCE_CONFLICT: {
    kind: "reference", title: "Referencia ya utilizada",
    message: "Esa referencia ya se usó para otra operación distinta. Usa una referencia nueva.",
  },
  BUDGET_BLOCKED: {
    kind: "budget", title: "Presupuesto de IA bloqueado",
    message: "El presupuesto de IA de este workspace está bloqueado. Contacta con tu administrador.",
  },
  PROVIDER_UNAVAILABLE: {
    kind: "provider", title: "Proveedor de IA no disponible",
    message: "El proveedor de IA no ha podido responder ahora mismo. No se ha cobrado nada; inténtalo de nuevo en unos minutos.",
    retryable: true,
  },
  permission_denied: {
    kind: "permission", title: "Sin permiso",
    message: "Tu rol no tiene permiso para esta acción. Contacta con tu administrador.",
  },
  module_disabled: {
    kind: "module", title: "Módulo no disponible",
    message: "El módulo AI Center no está activado en este workspace. Un administrador puede habilitarlo.",
  },
  no_org_context: {
    kind: "permission", title: "Sin workspace activo",
    message: "No hay un workspace activo. Selecciona uno e inténtalo de nuevo.",
  },
};

const BY_STATUS: Array<{ test: (s: number) => boolean; known: Known }> = [
  { test: (s) => s === 401, known: { kind: "auth", title: "Sesión no válida", message: "Tu sesión ha caducado. Vuelve a iniciar sesión." } },
  { test: (s) => s === 403, known: { kind: "permission", title: "Acceso denegado", message: "No tienes acceso a esta acción." } },
  { test: (s) => s === 404, known: { kind: "not_found", title: "No encontrado", message: "El recurso no existe o no pertenece a este workspace." } },
  { test: (s) => s === 409, known: { kind: "conflict", title: "Conflicto", message: "La operación no es posible en el estado actual del agente." } },
  { test: (s) => s === 400 || s === 422, known: { kind: "validation", title: "Datos no válidos", message: "Revisa los datos e inténtalo de nuevo." } },
  { test: (s) => s === 429, known: { kind: "budget", title: "Demasiadas peticiones", message: "Se ha superado un límite de uso. Inténtalo de nuevo más tarde.", retryable: true } },
  { test: (s) => s >= 500, known: { kind: "server", title: "Error del servidor", message: "El servidor no ha podido completar la petición. Inténtalo de nuevo en unos minutos.", retryable: true } },
];

function technicalLine(status: number | null, code: string | null, requestId: string | null): string {
  const parts = [`Código: ${code ?? "sin código"}`, `HTTP ${status ?? "—"}`];
  if (requestId) parts.push(`ID: ${requestId}`);
  return parts.join(" · ");
}

/** Describe un error ya normalizado (status, code, message, requestId). */
export function describeApiError(input: AgentErrorInput): AgentErrorInfo {
  const status = input.status ?? null;
  const code = input.code ?? null;
  const requestId = input.requestId ?? null;

  const known: Known =
    (code && BY_CODE[code])
    || (status !== null ? BY_STATUS.find((r) => r.test(status))?.known : undefined)
    || (status === null
      ? { kind: "network", title: "Sin conexión", message: "No se ha podido contactar con el servidor. Comprueba tu conexión e inténtalo de nuevo.", retryable: true }
      : { kind: "unknown", title: "Error inesperado", message: "Ha ocurrido un error inesperado." });

  const original = input.message?.trim() || null;
  return {
    status, code, requestId,
    kind: known.kind, title: known.title, message: known.message,
    // El mensaje del backend solo se repite si añade información distinta del texto genérico.
    detail: original && original !== known.message ? original : null,
    technical: technicalLine(status, code, requestId),
    retryable: known.retryable ?? false,
  };
}

/** Describe cualquier cosa lanzada por el cliente (AgentsApiError, TypeError de red, Error…). */
export function describeAgentError(err: unknown): AgentErrorInfo {
  if (err instanceof AgentsApiError) return describeApiError({ status: err.status, code: err.code, message: err.message, requestId: err.requestId });
  if (err instanceof Error) return describeApiError({ status: null, code: null, message: err.message });
  return describeApiError({ status: null, code: null, message: typeof err === "string" ? err : null });
}

/** Lista de problemas que devuelve el backend al rechazar una publicación (422 { error, problems }). */
export function errorProblems(err: unknown): string[] {
  if (!(err instanceof AgentsApiError) || !err.body || typeof err.body !== "object") return [];
  const p = (err.body as Record<string, unknown>)["problems"];
  return Array.isArray(p) ? p.filter((x): x is string => typeof x === "string") : [];
}
