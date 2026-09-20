import { describe, it, expect } from "vitest";
import { AgentsApiError, describeAgentError, describeApiError } from "@/lib/agents/agentErrors";

describe("describeApiError — errores estructurados del backend", () => {
  const cases: Array<[number, string, string, string]> = [
    [402, "INSUFFICIENT_CREDITS", "credits", "Créditos insuficientes"],
    [402, "CREDIT_LIMIT_REACHED", "limit", "Límite de créditos alcanzado"],
    [402, "AGENT_CREDIT_LIMIT_REACHED", "limit", "Presupuesto del agente agotado"],
    [409, "DUPLICATE_REQUEST", "duplicate", "Petición duplicada"],
    [409, "REFERENCE_CONFLICT", "reference", "Referencia ya utilizada"],
    [429, "BUDGET_BLOCKED", "budget", "Presupuesto de IA bloqueado"],
    [503, "PROVIDER_UNAVAILABLE", "provider", "Proveedor de IA no disponible"],
  ];

  it.each(cases)("HTTP %i %s → mensaje propio, con el código técnico visible", (status, code, kind, title) => {
    const info = describeApiError({ status, code, message: "mensaje del backend", requestId: "req-123" });
    expect(info.kind).toBe(kind);
    expect(info.title).toBe(title);
    expect(info.message).not.toMatch(/error genérico/i);
    expect(info.code).toBe(code);
    expect(info.technical).toBe(`Código: ${code} · HTTP ${status} · ID: req-123`);
    expect(info.detail).toBe("mensaje del backend");     // el texto original del backend no se pierde
  });

  it("los errores de créditos dicen que no se ha cobrado nada", () => {
    for (const code of ["INSUFFICIENT_CREDITS", "CREDIT_LIMIT_REACHED", "AGENT_CREDIT_LIMIT_REACHED", "PROVIDER_UNAVAILABLE"]) {
      expect(describeApiError({ status: 402, code, message: null }).message).toMatch(/no se ha cobrado nada/i);
    }
  });

  it("el proveedor no disponible es reintentable; los de créditos no", () => {
    expect(describeApiError({ status: 503, code: "PROVIDER_UNAVAILABLE", message: null }).retryable).toBe(true);
    expect(describeApiError({ status: 402, code: "INSUFFICIENT_CREDITS", message: null }).retryable).toBe(false);
  });

  it("no repite el detalle si es idéntico al mensaje mostrado", () => {
    const first = describeApiError({ status: 402, code: "INSUFFICIENT_CREDITS", message: null });
    expect(describeApiError({ status: 402, code: "INSUFFICIENT_CREDITS", message: first.message }).detail).toBeNull();
  });
});

describe("describeApiError — errores generales", () => {
  it("permission_denied y module_disabled se reconocen por código", () => {
    expect(describeApiError({ status: 403, code: "permission_denied", message: null })).toMatchObject({ kind: "permission", title: "Sin permiso" });
    expect(describeApiError({ status: 403, code: "module_disabled", message: null })).toMatchObject({ kind: "module", title: "Módulo no disponible" });
  });

  it("por estado HTTP cuando no hay código", () => {
    expect(describeApiError({ status: 401, code: null, message: null }).kind).toBe("auth");
    expect(describeApiError({ status: 404, code: null, message: "Agente no encontrado." })).toMatchObject({ kind: "not_found", detail: "Agente no encontrado." });
    expect(describeApiError({ status: 409, code: null, message: null }).kind).toBe("conflict");
    expect(describeApiError({ status: 422, code: null, message: null }).kind).toBe("validation");
    expect(describeApiError({ status: 500, code: null, message: null })).toMatchObject({ kind: "server", retryable: true });
  });

  it("sin HTTP es un fallo de red; y un HTTP desconocido NO se convierte en un 'error genérico' que oculte el código", () => {
    expect(describeApiError({ status: null, code: null, message: "Failed to fetch" })).toMatchObject({ kind: "network", retryable: true, detail: "Failed to fetch" });
    const odd = describeApiError({ status: 418, code: "TEAPOT", message: null });
    expect(odd.kind).toBe("unknown");
    expect(odd.technical).toBe("Código: TEAPOT · HTTP 418");   // el código técnico siempre se ve
  });
});

describe("describeAgentError", () => {
  it("acepta AgentsApiError, Error y valores raros", () => {
    const api = new AgentsApiError({ status: 402, code: "INSUFFICIENT_CREDITS", message: "sin saldo", requestId: "abc" });
    expect(describeAgentError(api)).toMatchObject({ status: 402, code: "INSUFFICIENT_CREDITS", requestId: "abc", kind: "credits" });
    expect(describeAgentError(new TypeError("Failed to fetch"))).toMatchObject({ kind: "network", status: null });
    expect(describeAgentError("texto").kind).toBe("network");
    expect(describeAgentError(undefined).technical).toBe("Código: sin código · HTTP —");
  });
});
