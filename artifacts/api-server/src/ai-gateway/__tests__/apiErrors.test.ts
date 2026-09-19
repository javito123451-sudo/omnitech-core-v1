// Un fallo de una operación de IA de pago nunca debe llegar al cliente como un
// error genérico: cada uno tiene un `status` estable y un HTTP propio.
import { describe, it, expect } from "vitest";
import { toApiError } from "../apiErrors";
import { AiBudgetBlockedError, AiProviderError } from "../gateway";
import { NoProviderAvailableError } from "../providerRouter";
import { CreditError, CreditLimitReachedError, DuplicateRequestError, InsufficientCreditsError } from "../../credits/errors";

describe("toApiError", () => {
  it("INSUFFICIENT_CREDITS: 402 con saldo, disponible y necesario", () => {
    const r = toApiError(new InsufficientCreditsError(10, 4, 6))!;
    expect(r.http).toBe(402);
    expect(r.body).toMatchObject({ status: "INSUFFICIENT_CREDITS", balance: 10, available: 4, required: 6 });
    expect(r.body.message).toMatch(/insuficientes/i);
  });

  it("CREDIT_LIMIT_REACHED: 402 con el ámbito del límite", () => {
    const r = toApiError(new CreditLimitReachedError("workspace_daily", 90, 100, 20))!;
    expect(r.http).toBe(402);
    expect(r.body).toMatchObject({ status: "CREDIT_LIMIT_REACHED", scope: "workspace_daily", used: 90, limit: 100, requested: 20 });
  });

  it("DUPLICATE_REQUEST: 409", () => {
    expect(toApiError(new DuplicateRequestError("req-1"))).toMatchObject({ http: 409, body: { status: "DUPLICATE_REQUEST", reference: "req-1" } });
  });

  it("BUDGET_BLOCKED: 429", () => {
    expect(toApiError(new AiBudgetBlockedError("Presupuesto agotado", 100))).toMatchObject({ http: 429, body: { status: "BUDGET_BLOCKED" } });
  });

  it("proveedor no disponible o fallido: 503 PROVIDER_UNAVAILABLE", () => {
    expect(toApiError(new NoProviderAvailableError())).toMatchObject({ http: 503, body: { status: "PROVIDER_UNAVAILABLE" } });
    expect(toApiError(new AiProviderError("todos fallaron", []))).toMatchObject({ http: 503, body: { status: "PROVIDER_UNAVAILABLE" } });
  });

  it("errores de validación de créditos: 400", () => {
    expect(toApiError(new CreditError("importe no válido"))).toMatchObject({ http: 400, body: { status: "CREDIT_INVALID" } });
  });

  it("un error desconocido no se disfraza de error de créditos", () => {
    expect(toApiError(new Error("boom"))).toBeNull();
  });
});
