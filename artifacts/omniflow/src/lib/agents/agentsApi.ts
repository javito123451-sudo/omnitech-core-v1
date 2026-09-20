// Cliente de Agent Factory. Sigue el patrón del proyecto: authFetch (token de Clerk + workspace activo) y
// TanStack Query en los hooks; sin ninguna librería HTTP nueva.
//
// SOLO endpoints que existen hoy (artifacts/api-server/src/routes/agents.ts, montado en /api/agents, módulo
// `ai_agents`, permisos agents.read / agents.write):
//   GET  /api/agents                  agents.read   → AgentListResponse
//   POST /api/agents                  agents.write  → CreateAgentResponse (201)
//   GET  /api/agents/:id              agents.read   → AgentDetailResponse
//   GET  /api/agents/credits/balance  agents.read   → CreditsBalance
//   GET  /api/agents/credits          agents.read   → CreditsDashboard (vista de cliente: sin tokens ni USD)
//   GET  /api/agents/defaults         agents.read   → DefaultAgentsResponse
// Nunca se envía `?technical=1`: es un modo técnico para administradores.

import { authFetch } from "@/lib/authFetch";
import { AgentsApiError } from "./agentErrors";
import type {
  AgentDetailResponse, AgentListResponse, CreateAgentInput, CreateAgentResponse,
  CreditsBalance, CreditsDashboard, DefaultAgentsResponse,
} from "./types";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export const AGENTS_API = `${BASE}/api/agents`;

/** Cabeceras donde un backend o un proxy podrían dejar el id de la petición. Solo se lee lo que venga. */
const REQUEST_ID_HEADERS = ["x-request-id", "x-render-request-id", "x-vercel-id"];

function readRequestId(res: Response, body: unknown): string | null {
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b["requestId"] === "string") return b["requestId"];
  }
  for (const h of REQUEST_ID_HEADERS) {
    const v = res.headers.get(h);
    if (v) return v;
  }
  return null;
}

/**
 * El backend responde JSON siempre. Errores estructurados: `{ status: "INSUFFICIENT_CREDITS", message, … }`
 * (toApiError). Errores generales: `{ error: "permission_denied" | "…texto…", message? }`.
 */
function toApiError(res: Response, body: unknown): AgentsApiError {
  let code: string | null = null;
  let message: string | null = null;
  if (body && typeof body === "object") {
    const b = body as Record<string, unknown>;
    if (typeof b["status"] === "string") code = b["status"];
    else if (typeof b["error"] === "string" && /^[a-z_]+$/.test(b["error"])) code = b["error"]; // permission_denied, module_disabled…
    message =
      typeof b["message"] === "string" ? b["message"]
      : typeof b["error"] === "string" && code !== b["error"] ? b["error"]
      : null;
  }
  return new AgentsApiError({ status: res.status, code, message, requestId: readRequestId(res, body), body });
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await authFetch(`${AGENTS_API}${path}`, init);
  } catch (err) {
    // Fallo de red o petición cancelada: sin HTTP. Se conserva el mensaje original.
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new AgentsApiError({ status: null, code: null, message: err instanceof Error ? err.message : null });
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) { try { body = JSON.parse(text); } catch { body = text; } }

  if (!res.ok) throw toApiError(res, body);
  return body as T;
}

export const agentsApi = {
  list:           (signal?: AbortSignal) => request<AgentListResponse>("", { signal }),
  get:            (id: number, signal?: AbortSignal) => request<AgentDetailResponse>(`/${id}`, { signal }),
  create:         (input: CreateAgentInput) => request<CreateAgentResponse>("", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
  }),
  creditsBalance: (signal?: AbortSignal) => request<CreditsBalance>("/credits/balance", { signal }),
  credits:        (signal?: AbortSignal) => request<CreditsDashboard>("/credits", { signal }),
  defaults:       (signal?: AbortSignal) => request<DefaultAgentsResponse>("/defaults", { signal }),
};
