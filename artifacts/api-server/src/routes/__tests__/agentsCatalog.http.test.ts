// Endpoints /api/agents/catalog/*: RBAC real (requirePermission del router), solo lectura y aislamiento por workspace.
// Se monta el agentsRouter de verdad en un Express mínimo con una identidad simulada; solo se sustituyen las dos lecturas
// de base de datos (precios y knowledge), para poder comprobar qué reciben.
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";

const listKnowledgeCatalog = vi.hoisted(() => vi.fn());
const getPricingReport = vi.hoisted(() => vi.fn());

vi.mock("../../agents/catalogService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../agents/catalogService")>()),
  listKnowledgeCatalog: (...a: unknown[]) => listKnowledgeCatalog(...a),
}));
vi.mock("../../ai-gateway/pricingService", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ai-gateway/pricingService")>()),
  getPricingReport: (...a: unknown[]) => getPricingReport(...a),
}));

import { agentsRouter } from "../agents";

const emptyReport = { official: [], dbProvisional: [], legacyProvisional: [] };

interface Identity { orgId?: number; role?: string; superAdmin?: boolean }
let identity: Identity = {};
let server: Server;
let base = "";

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, {
      orgId: identity.orgId, orgRole: identity.role, effectiveRole: identity.role, isSuperAdmin: identity.superAdmin === true,
      clerkUserId: "user_test", userId: 1,
    });
    next();
  });
  app.use("/api/agents", agentsRouter);
  await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/agents`;
});
afterAll(async () => { await new Promise((r) => server.close(r)); });

beforeEach(() => {
  identity = { orgId: 1, role: "member" };
  listKnowledgeCatalog.mockReset().mockResolvedValue([]);
  getPricingReport.mockReset().mockResolvedValue(emptyReport);
  process.env["OPENAI_API_KEY"] = "sk-test-not-real";
});

const get = (path: string) => fetch(`${base}${path}`);

describe("GET /catalog/tools", () => {
  it("con agents.read devuelve el catálogo: 22 tools, 11 de lectura y 11 de acción, ids únicos", async () => {
    const res = await get("/catalog/tools");
    expect(res.status).toBe(200);
    const body = await res.json() as Array<{ id: string; kind: string; permission: string; module: string; params: unknown[]; description: string }>;
    expect(body).toHaveLength(22);
    expect(body.filter((t) => t.kind === "read")).toHaveLength(11);
    expect(body.filter((t) => t.kind === "action")).toHaveLength(11);
    expect(new Set(body.map((t) => t.id)).size).toBe(22);
    for (const t of body) {
      expect(t.permission).toBeTruthy();
      expect(t.module).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(Array.isArray(t.params)).toBe(true);
    }
  });

  it.each(["owner", "admin", "manager", "member", "read_only"])("el rol %s (todos tienen agents.read) puede leerlo, sin exigir permisos de CRM", async (role) => {
    identity = { orgId: 1, role };
    expect((await get("/catalog/tools")).status).toBe(200);
  });

  it.each(["vendedor", "cliente", "client", "support", undefined])("el rol %s no tiene agents.read → 403 permission_denied", async (role) => {
    identity = { orgId: 1, role };
    const res = await get("/catalog/tools");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("permission_denied");
  });

  it("sin contexto de workspace → 403 no_org_context", async () => {
    identity = { orgId: undefined, role: "member" };
    const res = await get("/catalog/tools");
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("no_org_context");
  });

  it("es global: el mismo catálogo para cualquier workspace, sin datos scoped", async () => {
    identity = { orgId: 1, role: "member" };
    const a = await (await get("/catalog/tools")).json();
    identity = { orgId: 2, role: "member" };
    const b = await (await get("/catalog/tools")).json();
    expect(b).toEqual(a);
    expect(JSON.stringify(a)).not.toMatch(/orgId|org_id/);
  });

  it("no expone funciones, código ni secretos", async () => {
    const text = JSON.stringify(await (await get("/catalog/tools")).json());
    expect(text).not.toMatch(/execute|function\s*\(|=>|API_KEY|sk-test-not-real|process\.env/);
  });

  it("es solo lectura: POST, PUT, PATCH y DELETE no existen", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const res = await fetch(`${base}/catalog/tools`, { method, headers: { "content-type": "application/json" }, body: method === "DELETE" ? undefined : "{}" });
      expect(res.status, method).toBe(404);
    }
  });
});

describe("GET /catalog/models", () => {
  const report = {
    official: [{ provider: "openai", model: "gpt-5.6-luna", source: "https://docs.example/luna" }],
    dbProvisional: [{ provider: "openai", model: "modelo-nuevo", source: null }],
    legacyProvisional: [{ provider: "openai", model: "gpt-4o-mini" }, { provider: "openai", model: "text-embedding-3-small" }],
  };

  it("providers implementados y modelos: el informe de precios (BD vigente + heredados provisionales)", async () => {
    getPricingReport.mockResolvedValue(report);
    const res = await get("/catalog/models");
    expect(res.status).toBe(200);
    const body = await res.json() as { providers: unknown[]; models: Array<Record<string, unknown>> };
    expect(body.providers).toEqual([{ id: "openai", available: true }]);
    expect(body.models.find((m) => m.model === "gpt-5.6-luna")).toEqual({ provider: "openai", model: "gpt-5.6-luna", provisional: false, priceKnown: true, priceSource: "db", source: "https://docs.example/luna" });
    expect(body.models.find((m) => m.model === "modelo-nuevo")).toMatchObject({ provisional: true, priceSource: "db" });
    expect(body.models.find((m) => m.model === "gpt-4o-mini")).toMatchObject({ provisional: true, priceSource: "legacy" });
    expect(body.models.find((m) => m.model === "text-embedding-3-small")).toBeUndefined();
  });

  it("nunca ofrece providers stub (claude, gemini)", async () => {
    getPricingReport.mockResolvedValue({ ...report, official: [...report.official, { provider: "claude", model: "x", source: null }] });
    const text = JSON.stringify(await (await get("/catalog/models")).json());
    expect(text).not.toMatch(/claude|gemini/);
  });

  it("sin clave de OpenAI: available:false y ningún modelo seleccionable", async () => {
    delete process.env["OPENAI_API_KEY"];
    getPricingReport.mockResolvedValue(report);
    const body = await (await get("/catalog/models")).json() as { providers: unknown[]; models: unknown[] };
    expect(body.providers).toEqual([{ id: "openai", available: false }]);
    expect(body.models).toEqual([]);
  });

  it("no expone claves, variables de entorno, precios ni rutas internas", async () => {
    getPricingReport.mockResolvedValue({ ...report, official: [{ ...report.official[0]!, inputCost: 0.2, outputCost: 1.2 }] });
    const text = JSON.stringify(await (await get("/catalog/models")).json());
    expect(text).not.toMatch(/sk-test-not-real|API_KEY|OPENAI_|apiKeyEnv|timeoutMs|inputCost|outputCost|0\.2|1\.2/);
  });

  it("exige agents.read y es solo lectura", async () => {
    identity = { orgId: 1, role: "vendedor" };
    expect((await get("/catalog/models")).status).toBe(403);
    identity = { orgId: 1, role: "owner" };
    expect((await fetch(`${base}/catalog/models`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } })).status).toBe(404);
  });
});

describe("GET /catalog/knowledge", () => {
  it("devuelve id, título y categoría del workspace activo, y consulta SOLO con su orgId", async () => {
    listKnowledgeCatalog.mockResolvedValue([{ id: 5, title: "Horarios", category: "general" }]);
    identity = { orgId: 11, role: "member" };
    const res = await get("/catalog/knowledge");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 5, title: "Horarios", category: "general" }]);
    expect(listKnowledgeCatalog).toHaveBeenCalledTimes(1);
    expect(listKnowledgeCatalog).toHaveBeenCalledWith(11);
  });

  it("dos workspaces distintos consultan cada uno con su propio id (el cliente no puede elegir otro)", async () => {
    identity = { orgId: 1, role: "member" };
    await fetch(`${base}/catalog/knowledge?orgId=2`);
    identity = { orgId: 2, role: "member" };
    await fetch(`${base}/catalog/knowledge`);
    expect(listKnowledgeCatalog.mock.calls.map((c) => c[0])).toEqual([1, 2]);
  });

  it("ignora un orgId, una cabecera o un cuerpo que intenten apuntar a otro workspace", async () => {
    identity = { orgId: 3, role: "member" };
    await fetch(`${base}/catalog/knowledge?orgId=99&org_id=99`, { headers: { "x-active-workspace": "99", "x-ws-override": "99" } });
    expect(listKnowledgeCatalog).toHaveBeenCalledWith(3);
  });

  it("sin agents.read → 403 y no toca la base de datos", async () => {
    identity = { orgId: 1, role: "vendedor" };
    expect((await get("/catalog/knowledge")).status).toBe(403);
    expect(listKnowledgeCatalog).not.toHaveBeenCalled();
  });

  it("SUPER_ADMIN sin workspace activo no obtiene el conocimiento de nadie (400, sin consultar)", async () => {
    identity = { orgId: undefined, superAdmin: true };
    const res = await get("/catalog/knowledge");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("no_org_context");
    expect(listKnowledgeCatalog).not.toHaveBeenCalled();
  });

  it("SUPER_ADMIN dentro de un workspace ve solo ese workspace", async () => {
    identity = { orgId: 4, superAdmin: true };
    await get("/catalog/knowledge");
    expect(listKnowledgeCatalog).toHaveBeenCalledWith(4);
  });

  it("la respuesta no contiene contenido de documentos (la consulta ni lo selecciona: ver catalogService.test)", async () => {
    listKnowledgeCatalog.mockResolvedValue([{ id: 1, title: "T", category: "c" }]);
    const text = JSON.stringify(await (await get("/catalog/knowledge")).json());
    expect(text).not.toMatch(/content/);
  });

  it("es solo lectura", async () => {
    for (const method of ["POST", "PUT", "DELETE"]) {
      expect((await fetch(`${base}/catalog/knowledge`, { method, body: method === "DELETE" ? undefined : "{}", headers: { "content-type": "application/json" } })).status, method).toBe(404);
    }
  });
});
