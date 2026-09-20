// Publicación segura contra Postgres real: validación de modelo/fallbacks/conocimiento, sin guardados parciales y aislamiento
// entre workspaces. Requiere una base desechable en DATABASE_URL (ci-test); se omite limpiamente sin ella.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, aiAgentsTable, aiAgentVersionsTable, knowledgeBaseTable, defaultAgentConfig, type AgentConfig } from "@workspace/db";
import { AgentError, createAgent, getAgentDetail, publishAgent, restoreVersion, saveDraft, readConfig } from "../agentService";
import { previewEffectiveAccess } from "../effectiveAccess";
import type { ModelCatalog } from "../catalogService";
import { getAvailable } from "../../credits/creditService";
import { listSkills } from "../../skills";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const known = () => new Set(listSkills().map((s) => s.id));

const catalog: ModelCatalog = {
  providers: [{ id: "openai", available: true }],
  models: [
    { provider: "openai", model: "gpt-5.6-luna", provisional: false, priceKnown: true, priceSource: "db", source: "s" },
    { provider: "openai", model: "gpt-4o-mini", provisional: true, priceKnown: true, priceSource: "legacy", source: null },
  ],
};
const deps = { loadModelCatalog: async () => catalog };

const ready = (over: Partial<AgentConfig> = {}): Partial<AgentConfig> => ({
  objective: { what: "Atender consultas", audience: "clientes", expectedOutcome: "cita" },
  behavior: { instructions: "Sé amable.", rules: [], restrictions: [], avoid: [] },
  ...over,
});

describe.skipIf(!hasRealDb)("publicación segura (Postgres)", () => {
  let A = 0, B = 0;
  let kbA = 0, kbAOff = 0, kbB = 0;

  beforeAll(async () => {
    [A, B] = (await createTempOrgs(2, "secure-pub")) as [number, number];
    const rows = await db.insert(knowledgeBaseTable).values([
      { orgId: A, title: "A activa", content: "c" },
      { orgId: A, title: "A inactiva", content: "c", isActive: false },
      { orgId: B, title: "B activa", content: "c" },
    ]).returning({ id: knowledgeBaseTable.id, title: knowledgeBaseTable.title });
    const id = (t: string) => rows.find((r) => r.title === t)!.id;
    kbA = id("A activa"); kbAOff = id("A inactiva"); kbB = id("B activa");
  });
  afterAll(async () => { await deleteTempOrgs([A, B]); });

  const newAgent = async (org = A) => (await createAgent(org, "smoke", { name: "Agente" })).agent;
  const stateOf = async (agentId: number) => {
    const [agent] = await db.select().from(aiAgentsTable).where(eq(aiAgentsTable.id, agentId));
    const versions = await db.select().from(aiAgentVersionsTable).where(eq(aiAgentVersionsTable.agentId, agentId));
    return { agent: agent!, versions };
  };

  describe("modelo y proveedor", () => {
    it("configuración válida (con y sin modelo fijo) publica", async () => {
      const a = await newAgent(); await saveDraft(A, a.id, "u", ready());
      await expect(publishAgent(A, a.id, known(), deps)).resolves.toMatchObject({ publishedVersionNumber: 1 });
      const b = await newAgent(); await saveDraft(A, b.id, "u", ready({ model: { provider: "openai", model: "gpt-5.6-luna", fallbacks: [{ provider: "openai", model: "gpt-4o-mini" }] } }));
      await expect(publishAgent(A, b.id, known(), deps)).resolves.toBeTruthy();
    });

    it("modelo inexistente → 422 estructurado y NO se publica nada", async () => {
      const a = await newAgent(); await saveDraft(A, a.id, "u", ready({ model: { provider: "openai", model: "fantasma" } }));
      const err = await publishAgent(A, a.id, known(), deps).catch((e) => e) as AgentError;
      expect(err).toBeInstanceOf(AgentError);
      expect(err.status).toBe(422);
      expect(err.details).toEqual([expect.objectContaining({ field: "config.model.model", code: "UNKNOWN_MODEL" })]);
      const s = await stateOf(a.id);
      expect(s.agent.status).toBe("draft");
      expect(s.agent.activeVersionId).toBeNull();
      expect(s.versions.every((v) => v.publishedAt === null)).toBe(true);
    });

    it("provider inexistente, provider stub y fallback inventado → 422", async () => {
      for (const model of [{ provider: "acme", model: "x" }, { provider: "claude" }, { provider: "openai", model: "gpt-5.6-luna", fallbacks: [{ provider: "openai", model: "nope" }] }]) {
        const a = await newAgent(); await saveDraft(A, a.id, "u", ready({ model }));
        await expect(publishAgent(A, a.id, known(), deps)).rejects.toMatchObject({ status: 422 });
      }
    });

    it("no consulta el catálogo si no hay modelo fijo", async () => {
      const a = await newAgent(); await saveDraft(A, a.id, "u", ready());
      let called = 0;
      await publishAgent(A, a.id, known(), { loadModelCatalog: async () => { called++; return catalog; } });
      expect(called).toBe(0);
    });
  });

  describe("conocimiento en el borrador", () => {
    const withIds = (ids: number[]) => ready({ knowledge: { workspace: false, entryIds: ids, categories: [] } });

    it("ids válidos se guardan", async () => {
      const a = await newAgent();
      const v = await saveDraft(A, a.id, "u", withIds([kbA]));
      expect(readConfig(v).knowledge.entryIds).toEqual([kbA]);
    });

    it.each([
      ["id inexistente", () => [987654321]],
      ["id de otro workspace", () => [kbB]],
      ["entrada inactiva", () => [kbAOff]],
      ["mezcla válido + inválido", () => [kbA, kbB]],
    ])("%s → 422 y no se guarda NADA (ni la sección ni el resto del parche)", async (_name, ids) => {
      const a = await newAgent();
      const before = await saveDraft(A, a.id, "u", ready({ identity: { role: "original" } }));
      const err = await saveDraft(A, a.id, "u", { identity: { role: "cambiado" }, knowledge: { workspace: false, entryIds: ids(), categories: [] } }).catch((e) => e) as AgentError;
      expect(err).toBeInstanceOf(AgentError);
      expect(err.status).toBe(422);
      expect(err.details[0]).toMatchObject({ field: "config.knowledge.entryIds", code: "UNKNOWN_KNOWLEDGE_ENTRY" });
      const { versions } = await stateOf(a.id);
      const draft = versions.find((v) => v.publishedAt === null)!;
      expect(readConfig(draft).identity.role).toBe("original");
      expect(readConfig(draft).knowledge.entryIds).toEqual(readConfig(before).knowledge.entryIds);
    });

    it("un parche sin conocimiento no valida ni toca los ids ya guardados", async () => {
      const a = await newAgent();
      await saveDraft(A, a.id, "u", withIds([kbA]), undefined, { validateKnowledge: false });
      await expect(saveDraft(A, a.id, "u", { identity: { role: "otro" } })).resolves.toBeTruthy();
    });

    it("publicar con un id que dejó de ser válido → 422; restaurar una versión propia sigue permitido", async () => {
      const a = await newAgent();
      await saveDraft(A, a.id, "u", ready({ ...withIds([kbA]) }));
      await publishAgent(A, a.id, known(), deps);
      await db.update(knowledgeBaseTable).set({ isActive: false }).where(eq(knowledgeBaseTable.id, kbA));
      try {
        const restored = await restoreVersion(A, a.id, (await getAgentDetail(A, a.id)).versions[0]!.id, "u");
        expect(restored.publishedAt).toBeNull();
        await expect(publishAgent(A, a.id, known(), deps)).rejects.toMatchObject({ status: 422 });
      } finally {
        await db.update(knowledgeBaseTable).set({ isActive: true }).where(eq(knowledgeBaseTable.id, kbA));
      }
    });
  });

  describe("herramientas", () => {
    it("tool desconocida o de tipo incorrecto no se publica", async () => {
      const a = await newAgent(); await saveDraft(A, a.id, "u", ready({ tools: { read: ["hackear"], write: [] } }));
      await expect(publishAgent(A, a.id, known(), deps)).rejects.toMatchObject({ status: 422 });
      const b = await newAgent(); await saveDraft(A, b.id, "u", ready({ tools: { read: ["create_task"], write: [] } }));
      await expect(publishAgent(A, b.id, known(), deps)).rejects.toMatchObject({ status: 422 });
    });

    it("writesRequireConfirmation:false no se publica", async () => {
      const a = await newAgent(); await saveDraft(A, a.id, "u", ready({ permissions: { writesRequireConfirmation: false } }));
      await expect(publishAgent(A, a.id, known(), deps)).rejects.toMatchObject({ status: 422 });
    });
  });

  describe("publicar no consume créditos", () => {
    it("el saldo no cambia", async () => {
      const a = await newAgent(); await saveDraft(A, a.id, "u", ready());
      const before = await getAvailable(A);
      await publishAgent(A, a.id, known(), deps);
      expect(await getAvailable(A)).toEqual(before);
    });
  });

  describe("aislamiento entre workspaces", () => {
    it("B no puede leer, modificar, publicar ni ver el acceso efectivo del agente de A", async () => {
      const a = await newAgent(A); await saveDraft(A, a.id, "u", ready());
      await expect(getAgentDetail(B, a.id)).rejects.toMatchObject({ status: 404 });
      await expect(saveDraft(B, a.id, "u", { identity: { role: "hack" } })).rejects.toMatchObject({ status: 404 });
      await expect(publishAgent(B, a.id, known(), deps)).rejects.toMatchObject({ status: 404 });
      await expect(previewEffectiveAccess({ orgId: B, orgRole: "owner", platformRole: null }, a.id)).rejects.toMatchObject({ status: 404 });
      const s = await stateOf(a.id);
      expect(s.agent.status).toBe("draft");
      expect(readConfig(s.versions[0]!).identity.role).toBe(defaultAgentConfig().identity.role);
    });

    it("el knowledge de B no se puede meter en el borrador de A", async () => {
      const a = await newAgent(A);
      await expect(saveDraft(A, a.id, "u", { knowledge: { workspace: false, entryIds: [kbB], categories: [] } })).rejects.toMatchObject({ status: 422 });
    });

    it("effective-access de A funciona para A", async () => {
      const a = await newAgent(A); await saveDraft(A, a.id, "u", ready({ tools: { read: ["list_tasks"], write: ["create_task"] } }));
      const r = await previewEffectiveAccess({ orgId: A, orgRole: "admin", platformRole: null }, a.id, { moduleEnabled: async () => true });
      expect(r.tools.map((t) => t.toolId)).toEqual(["list_tasks", "create_task"]);
    });
  });
});
