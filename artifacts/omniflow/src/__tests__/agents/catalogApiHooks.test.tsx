import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const session = vi.hoisted(() => ({ orgId: 1 as number | null }));
const authFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/orgContext", () => ({
  useOrg: () => ({
    org: session.orgId === null ? null : { id: session.orgId, name: "o", slug: "o", plan: "starter", role: "member" },
    loading: false, platformRole: "NONE", platformRoleLoading: false, permissions: ["agents.read"], hasPermission: () => true,
  }),
}));
vi.mock("@/lib/authFetch", () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

import { agentsApi, AGENTS_API } from "@/lib/agents/agentsApi";
import { AgentsApiError, describeAgentError } from "@/lib/agents/agentErrors";
import { agentKeys, useAgentKnowledgeCatalog, useAgentModelCatalog, useAgentToolCatalog } from "@/lib/agents/hooks";
import { json, knowledgeCatalog, modelCatalog, toolCatalog } from "./fixtures";

const path = (url: unknown) => String(url).replace(/^.*\/api\/agents/, "");

beforeEach(() => {
  authFetch.mockReset();
  session.orgId = 1;
  authFetch.mockImplementation(async (url: string) => {
    const p = path(url);
    if (p === "/catalog/tools") return json(200, toolCatalog());
    if (p === "/catalog/models") return json(200, modelCatalog());
    if (p === "/catalog/knowledge") return json(200, session.orgId === 1 ? knowledgeCatalog() : [{ id: 77, title: "Solo del WS2", category: "x" }]);
    throw new Error(`ruta no prevista: ${p}`);
  });
});

describe("cliente de catálogos", () => {
  it("cada método pide su endpoint real por GET, sin orgId, sin ?technical y sin cabeceras propias", async () => {
    await agentsApi.getToolCatalog();
    await agentsApi.getModelCatalog();
    await agentsApi.getKnowledgeCatalog();
    expect(authFetch.mock.calls.map((c) => c[0])).toEqual([`${AGENTS_API}/catalog/tools`, `${AGENTS_API}/catalog/models`, `${AGENTS_API}/catalog/knowledge`]);
    for (const [url, init] of authFetch.mock.calls as Array<[string, RequestInit]>) {
      expect(url).not.toMatch(/orgId|org_id|workspace|technical|\?/);
      expect(init.method ?? "GET").toBe("GET");
      expect(init.headers).toBeUndefined();          // el workspace lo añade authFetch (x-active-workspace), no este cliente
      expect(init.body).toBeUndefined();
    }
  });

  it("devuelve exactamente lo que responde el backend", async () => {
    expect(await agentsApi.getToolCatalog()).toEqual(toolCatalog());
    expect(await agentsApi.getModelCatalog()).toEqual(modelCatalog());
    expect(await agentsApi.getKnowledgeCatalog()).toEqual(knowledgeCatalog());
  });

  it.each([
    [401, { error: "unauthorized" }, "auth"],
    [403, { error: "permission_denied", message: "No tienes permiso (agents.read)" }, "permission"],
    [404, { error: "Not Found" }, "not_found"],
    [409, { error: "conflicto" }, "conflict"],
    [422, { error: "no válido" }, "validation"],
    [429, { error: "too many" }, "unknown"],
    [500, { error: "boom" }, "server"],
    [503, { error: "down" }, "server"],
  ])("HTTP %i se traduce con el sistema de errores existente y conserva el código", async (status, body, kind) => {
    authFetch.mockImplementation(async () => json(status, body));
    const err = await agentsApi.getModelCatalog().catch((e) => e);
    expect(err).toBeInstanceOf(AgentsApiError);
    expect(err.status).toBe(status);
    const info = describeAgentError(err);
    expect(info.technical).toContain(`HTTP ${status}`);
    expect(info.message).toBeTruthy();
    if (status !== 429) expect(info.kind).toBe(kind);
  });

  it("los tipos del catálogo no incluyen precios ni contenido", async () => {
    const text = JSON.stringify([await agentsApi.getModelCatalog(), await agentsApi.getKnowledgeCatalog()]);
    expect(text).not.toMatch(/inputCost|outputCost|Per1M|content|API_KEY/);
  });
});

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return { client, wrap: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}

describe("hooks de catálogos", () => {
  it("las claves incluyen el workspace activo", async () => {
    expect(agentKeys.catalogTools(5)).toEqual(["agent-catalog-tools", 5]);
    expect(agentKeys.catalogModels(5)).toEqual(["agent-catalog-models", 5]);
    expect(agentKeys.catalogKnowledge(5)).toEqual(["agent-catalog-knowledge", 5]);

    const { client, wrap } = wrapper();
    const tools = renderHook(() => useAgentToolCatalog(), { wrapper: wrap });
    const models = renderHook(() => useAgentModelCatalog(), { wrapper: wrap });
    const kb = renderHook(() => useAgentKnowledgeCatalog(), { wrapper: wrap });
    await waitFor(() => expect(tools.result.current.isSuccess && models.result.current.isSuccess && kb.result.current.isSuccess).toBe(true));
    expect(client.getQueryData(["agent-catalog-tools", 1])).toEqual(toolCatalog());
    expect(client.getQueryData(["agent-catalog-models", 1])).toEqual(modelCatalog());
    expect(client.getQueryData(["agent-catalog-knowledge", 1])).toEqual(knowledgeCatalog());
  });

  it("estados: loading → success", async () => {
    const { wrap } = wrapper();
    const { result } = renderHook(() => useAgentModelCatalog(), { wrapper: wrap });
    expect(result.current.isPending).toBe(true);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.models).toHaveLength(2);
  });

  it("estado de error", async () => {
    authFetch.mockImplementation(async () => json(500, { error: "boom" }));
    const { wrap } = wrapper();
    const { result } = renderHook(() => useAgentKnowledgeCatalog(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBeInstanceOf(AgentsApiError);
  });

  it("no mezcla workspaces: al cambiar de workspace pide de nuevo y no devuelve los datos del anterior", async () => {
    const { client, wrap } = wrapper();
    const { result, rerender } = renderHook(() => useAgentKnowledgeCatalog(), { wrapper: wrap });
    await waitFor(() => expect(result.current.data).toEqual(knowledgeCatalog()));

    session.orgId = 2;
    rerender();
    expect(result.current.data).toBeUndefined();                       // nunca los datos del workspace 1
    await waitFor(() => expect(result.current.data).toEqual([{ id: 77, title: "Solo del WS2", category: "x" }]));
    expect(client.getQueryData(["agent-catalog-knowledge", 1])).toEqual(knowledgeCatalog());
    expect(client.getQueryData(["agent-catalog-knowledge", 2])).toEqual([{ id: 77, title: "Solo del WS2", category: "x" }]);
    expect(authFetch).toHaveBeenCalledTimes(2);
  });

  it("sin workspace activo o con enabled=false no se llama a la API", async () => {
    session.orgId = null;
    const a = wrapper();
    renderHook(() => useAgentModelCatalog(), { wrapper: a.wrap });
    session.orgId = 1;
    const b = wrapper();
    renderHook(() => useAgentToolCatalog(false), { wrapper: b.wrap });
    await new Promise((r) => setTimeout(r, 30));
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("son datos casi estáticos: staleTime largo, sin polling", async () => {
    const { client, wrap } = wrapper();
    const { result } = renderHook(() => useAgentToolCatalog(), { wrapper: wrap });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const q = client.getQueryCache().find({ queryKey: ["agent-catalog-tools", 1] })!;
    expect((q.options as { staleTime?: number }).staleTime).toBeGreaterThanOrEqual(5 * 60 * 1000);
    expect((q.options as { refetchInterval?: unknown }).refetchInterval).toBeUndefined();
    // un segundo consumidor dentro del staleTime reutiliza la caché: no hay otra petición
    renderHook(() => useAgentToolCatalog(), { wrapper: wrap });
    await new Promise((r) => setTimeout(r, 30));
    expect(authFetch).toHaveBeenCalledTimes(1);
  });
});
