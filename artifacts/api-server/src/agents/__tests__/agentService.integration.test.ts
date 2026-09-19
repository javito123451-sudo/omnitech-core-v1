// Ciclo de vida real de un agente contra la base de datos: versiones
// inmutables, máquina de estados, y aislamiento entre organizaciones.
//
// Requiere una base desechable en DATABASE_URL (rama ci-test de Neon con la
// migración 0004 aplicada). Se omite limpiamente si no hay.
import { describe, it, expect, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db, aiAgentsTable, organizationsTable } from "@workspace/db";
import {
  AgentError, createAgent, getAgentDetail, listAgents, publishAgent, restoreVersion,
  saveDraft, transitionAgent, updateAgentMeta, readConfig,
} from "../agentService";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");
const known = new Set(["list_clients", "list_tasks", "create_task"]);
const cleanupIds: number[] = [];

async function twoOrgIds(): Promise<[number, number]> {
  const orgs = await db.select({ id: organizationsTable.id }).from(organizationsTable).limit(2);
  if (orgs.length < 2) throw new Error("La base de pruebas necesita al menos 2 organizaciones.");
  return [orgs[0]!.id, orgs[1]!.id];
}

async function newAgent(orgId: number, name = "Agente smoke") {
  const { agent } = await createAgent(orgId, "smoke-user", { name });
  cleanupIds.push(agent.id);
  return agent;
}

const ready = {
  objective: { what: "Atender consultas", audience: "clientes", expectedOutcome: "cita agendada" },
  behavior: { instructions: "Sé amable.", rules: [], restrictions: [], avoid: [] },
};

async function expectAgentError(p: Promise<unknown>, status: number) {
  await expect(p).rejects.toMatchObject({ name: "AgentError", status });
}

describe.skipIf(!hasRealDb)("Fábrica de Agentes — ciclo de vida", () => {
  afterAll(async () => {
    for (const id of cleanupIds) await db.delete(aiAgentsTable).where(eq(aiAgentsTable.id, id));
  });

  it("nace como borrador con una versión 1 editable", async () => {
    const [orgA] = await twoOrgIds();
    const agent = await newAgent(orgA);
    const { versions } = await getAgentDetail(orgA, agent.id);
    expect(agent.status).toBe("draft");
    expect(agent.activeVersionId).toBeNull();
    expect(versions).toHaveLength(1);
    expect(versions[0]!.publishedAt).toBeNull();
  });

  it("no publica un agente incompleto y explica por qué", async () => {
    const [orgA] = await twoOrgIds();
    const agent = await newAgent(orgA);
    await expect(publishAgent(orgA, agent.id, known)).rejects.toMatchObject({ status: 422 });
    const after = (await getAgentDetail(orgA, agent.id)).agent;
    expect(after.status).toBe("draft");
  });

  it("al publicar congela la versión; editar después crea una versión nueva sin tocar la publicada", async () => {
    const [orgA] = await twoOrgIds();
    const agent = await newAgent(orgA);
    await saveDraft(orgA, agent.id, "u", { ...ready, tools: { read: ["list_clients"], write: [] } });
    const { agent: published, publishedVersionNumber } = await publishAgent(orgA, agent.id, known);
    expect(published.status).toBe("published");
    expect(publishedVersionNumber).toBe(1);

    const v1Before = (await getAgentDetail(orgA, agent.id)).versions.find((v) => v.versionNumber === 1)!;
    expect(v1Before.publishedAt).not.toBeNull();

    const v2 = await saveDraft(orgA, agent.id, "u", { businessContext: "Cambio para la v2" });
    expect(v2.versionNumber).toBe(2);
    expect(v2.publishedAt).toBeNull();

    const detail = await getAgentDetail(orgA, agent.id);
    const v1After = detail.versions.find((v) => v.versionNumber === 1)!;
    expect(readConfig(v1After).businessContext).toBe("");       // v1 intacta
    expect(readConfig(v1After)).toEqual(readConfig(v1Before));
    expect(detail.agent.activeVersionId).toBe(v1After.id);      // producción sigue en v1

    await publishAgent(orgA, agent.id, known);
    const after = await getAgentDetail(orgA, agent.id);
    expect(after.agent.activeVersionId).toBe(v2.id);
  });

  it("restaurar una versión antigua la copia a un borrador sin modificar la original", async () => {
    const [orgA] = await twoOrgIds();
    const agent = await newAgent(orgA);
    await saveDraft(orgA, agent.id, "u", { ...ready, businessContext: "original" });
    await publishAgent(orgA, agent.id, known);
    await saveDraft(orgA, agent.id, "u", { businessContext: "cambiado" });
    await publishAgent(orgA, agent.id, known);

    const { versions } = await getAgentDetail(orgA, agent.id);
    const v1 = versions.find((v) => v.versionNumber === 1)!;
    const restored = await restoreVersion(orgA, agent.id, v1.id, "u");
    expect(restored.versionNumber).toBe(3);
    expect(restored.publishedAt).toBeNull();
    expect(readConfig(restored).businessContext).toBe("original");
    expect(readConfig(v1).businessContext).toBe("original");
  });

  it("rechaza publicar una herramienta de escritura colada en la lista de lectura", async () => {
    const [orgA] = await twoOrgIds();
    const agent = await newAgent(orgA);
    await saveDraft(orgA, agent.id, "u", { ...ready, tools: { read: ["create_task"], write: [] } });
    await expectAgentError(publishAgent(orgA, agent.id, known), 422);
  });

  it("respeta la máquina de estados", async () => {
    const [orgA] = await twoOrgIds();
    const agent = await newAgent(orgA);
    await expectAgentError(transitionAgent(orgA, agent.id, "pause"), 409);   // draft no se pausa
    await saveDraft(orgA, agent.id, "u", ready);
    await publishAgent(orgA, agent.id, known);

    expect((await transitionAgent(orgA, agent.id, "pause")).status).toBe("paused");
    await expectAgentError(transitionAgent(orgA, agent.id, "pause"), 409);
    expect((await transitionAgent(orgA, agent.id, "resume")).status).toBe("published");

    const unpublished = await transitionAgent(orgA, agent.id, "unpublish");
    expect(unpublished.status).toBe("draft");
    expect(unpublished.activeVersionId).toBeNull();

    const archived = await transitionAgent(orgA, agent.id, "archive");
    expect(archived.status).toBe("archived");
    await expectAgentError(updateAgentMeta(orgA, agent.id, { name: "x" }), 409);
    await expectAgentError(saveDraft(orgA, agent.id, "u", {}), 409);
    await expectAgentError(publishAgent(orgA, agent.id, known), 409);
  });

  it("aísla organizaciones: la org B no ve ni toca agentes de la org A", async () => {
    const [orgA, orgB] = await twoOrgIds();
    const agent = await newAgent(orgA, "Solo de A");
    await saveDraft(orgA, agent.id, "u", ready);

    expect((await listAgents(orgB)).some((a) => a.id === agent.id)).toBe(false);
    expect((await listAgents(orgA)).some((a) => a.id === agent.id)).toBe(true);

    await expectAgentError(getAgentDetail(orgB, agent.id), 404);
    await expectAgentError(updateAgentMeta(orgB, agent.id, { name: "robado" }), 404);
    await expectAgentError(saveDraft(orgB, agent.id, "u", { businessContext: "x" }), 404);
    await expectAgentError(publishAgent(orgB, agent.id, known), 404);
    await expectAgentError(transitionAgent(orgB, agent.id, "archive"), 404);

    const { versions } = await getAgentDetail(orgA, agent.id);
    await expectAgentError(restoreVersion(orgB, agent.id, versions[0]!.id, "u"), 404);
    expect((await getAgentDetail(orgA, agent.id)).agent.name).toBe("Solo de A");
  });
});

// Evita que el linter marque AgentError como sin usar: es parte del contrato probado arriba.
void AgentError;
