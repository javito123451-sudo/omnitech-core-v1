import { describe, it, expect, vi, beforeEach } from "vitest";

const authFetch = vi.hoisted(() => vi.fn());
vi.mock("@/lib/authFetch", () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

import { agentsApi, AGENTS_API } from "@/lib/agents/agentsApi";
import { AgentsApiError } from "@/lib/agents/agentErrors";

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

beforeEach(() => authFetch.mockReset());

describe("agentsApi — solo endpoints que existen", () => {
  it("cada método llama a su ruta real de /api/agents", async () => {
    authFetch.mockImplementation(async () => json(200, []));
    await agentsApi.list();
    await agentsApi.get(7);
    await agentsApi.creditsBalance();
    await agentsApi.credits();
    await agentsApi.defaults();
    expect(authFetch.mock.calls.map((c) => c[0])).toEqual([
      AGENTS_API, `${AGENTS_API}/7`, `${AGENTS_API}/credits/balance`, `${AGENTS_API}/credits`, `${AGENTS_API}/defaults`,
    ]);
    expect(AGENTS_API.endsWith("/api/agents")).toBe(true);
  });

  it("nunca pide el modo técnico (?technical=1): el cliente de workspace solo ve créditos", async () => {
    authFetch.mockImplementation(async () => json(200, {}));
    await agentsApi.credits();
    await agentsApi.creditsBalance();
    await agentsApi.list();
    for (const [url] of authFetch.mock.calls) expect(String(url)).not.toMatch(/technical/);
  });

  it("crear envía POST con JSON y solo los campos dados (sin config si no se pasa)", async () => {
    authFetch.mockImplementation(async () => json(201, { agent: { id: 9 }, version: { id: 1 } }));
    const res = await agentsApi.create({ name: "Ana", description: null, avatarUrl: null });
    const [url, init] = authFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(AGENTS_API);
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ name: "Ana", description: null, avatarUrl: null });
    expect(res.agent.id).toBe(9);
  });
});

describe("agentsApi — errores", () => {
  it("un error estructurado del gateway conserva su código, mensaje y HTTP", async () => {
    authFetch.mockImplementation(async () => json(402, { status: "INSUFFICIENT_CREDITS", message: "Créditos insuficientes: disponibles 0", balance: 0 }));
    const err = await agentsApi.list().catch((e) => e);
    expect(err).toBeInstanceOf(AgentsApiError);
    expect(err).toMatchObject({ status: 402, code: "INSUFFICIENT_CREDITS", message: "Créditos insuficientes: disponibles 0" });
  });

  it("permission_denied / module_disabled se leen de `error`", async () => {
    authFetch.mockImplementation(async () => json(403, { error: "permission_denied", message: "No tienes permiso (agents.write)" }));
    expect(await agentsApi.create({ name: "x" }).catch((e) => e)).toMatchObject({ status: 403, code: "permission_denied", message: "No tienes permiso (agents.write)" });
    authFetch.mockImplementation(async () => json(403, { error: "module_disabled", message: "módulo off" }));
    expect(await agentsApi.list().catch((e) => e)).toMatchObject({ code: "module_disabled" });
  });

  it("un error de texto del backend (AgentError) es el mensaje, sin código", async () => {
    authFetch.mockImplementation(async () => json(404, { error: "Agente no encontrado." }));
    expect(await agentsApi.get(1).catch((e) => e)).toMatchObject({ status: 404, code: null, message: "Agente no encontrado." });
  });

  it("recoge el id de la petición del cuerpo o de la cabecera, solo si viene", async () => {
    authFetch.mockImplementation(async () => json(503, { status: "PROVIDER_UNAVAILABLE", message: "x", requestId: "body-id" }));
    expect((await agentsApi.list().catch((e) => e)).requestId).toBe("body-id");
    authFetch.mockImplementation(async () => json(500, { error: "boom" }, { "x-request-id": "hdr-id" }));
    expect((await agentsApi.list().catch((e) => e)).requestId).toBe("hdr-id");
    authFetch.mockImplementation(async () => json(500, { error: "boom" }));
    expect((await agentsApi.list().catch((e) => e)).requestId).toBeNull();   // no se inventa
  });

  it("un fallo de red no tiene HTTP; una respuesta que no es JSON tampoco rompe el cliente", async () => {
    authFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    expect(await agentsApi.list().catch((e) => e)).toMatchObject({ status: null, code: null, message: "Failed to fetch" });
    authFetch.mockImplementation(async () => new Response("<html>bad gateway</html>", { status: 502 }));
    expect(await agentsApi.list().catch((e) => e)).toMatchObject({ status: 502, code: null });
  });
});
