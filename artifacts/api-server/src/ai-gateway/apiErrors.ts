// Traduce los fallos de una operación de IA de pago a una respuesta HTTP
// ESTRUCTURADA. Cada uno lleva un `status` estable (INSUFFICIENT_CREDITS,
// CREDIT_LIMIT_REACHED…) para que el frontend y los canales reaccionen sin
// interpretar textos, y nunca se convierten en un 500 genérico. Ninguno de
// ellos significa que se haya cobrado algo.

import {
  AiBudgetBlockedError, AiProviderError,
} from "./gateway";
import { NoProviderAvailableError } from "./providerRouter";
import { AgentCreditLimitReachedError, CreditError, CreditLimitReachedError, DuplicateRequestError, InsufficientCreditsError, ReferenceConflictError } from "../credits/errors";

export interface ApiErrorBody {
  status:  string;
  message: string;
  [detail: string]: unknown;
}

export function toApiError(err: unknown): { http: number; body: ApiErrorBody } | null {
  if (err instanceof InsufficientCreditsError) {
    return { http: 402, body: { status: "INSUFFICIENT_CREDITS", message: err.message, balance: err.balance, available: err.available, required: err.required } };
  }
  if (err instanceof CreditLimitReachedError) {
    return { http: 402, body: { status: "CREDIT_LIMIT_REACHED", message: err.message, scope: err.scope, used: err.used, limit: err.limit, requested: err.requested } };
  }
  if (err instanceof AgentCreditLimitReachedError) {
    return { http: 402, body: { status: "AGENT_CREDIT_LIMIT_REACHED", message: err.message, scope: err.scope, used: err.used, limit: err.limit, requested: err.requested } };
  }
  if (err instanceof DuplicateRequestError) {
    return { http: 409, body: { status: "DUPLICATE_REQUEST", message: err.message, reference: err.reference } };
  }
  if (err instanceof ReferenceConflictError) {
    return { http: 409, body: { status: "REFERENCE_CONFLICT", message: err.message, reference: err.reference } };
  }
  if (err instanceof AiBudgetBlockedError) {
    return { http: 429, body: { status: "BUDGET_BLOCKED", message: err.reason, pct: err.pct } };
  }
  if (err instanceof NoProviderAvailableError || err instanceof AiProviderError) {
    return { http: 503, body: { status: "PROVIDER_UNAVAILABLE", message: err.message } };
  }
  if (err instanceof CreditError) return { http: 400, body: { status: "CREDIT_INVALID", message: err.message } };
  return null;
}
