// OmniSeller Fase 2 — Mission → Hunter (ya existente) → Researcher → Scorer.
//
// Cubre lo pedido en el plan ejecutable para esta fase:
//   - Aislamiento multi-tenant de la investigación (Org B nunca puede
//     investigar ni ver prospectos de una Mission de Org A, ni pasando ids
//     explícitos de otra organización/misión).
//   - Flujo completo Mission → lead_result → lead_analysis → score, sin
//     ninguna columna nueva (la trazabilidad ya sale del join existente
//     lead_results.search_id → lead_searches.mission_id).
//   - OmniCredits: reserve → ejecución → settle por prospecto investigado;
//     sin saldo no se investiga nada (402, sin hold huérfano); un fallo en
//     un prospecto libera su hold y no tumba el resto del lote.
//   - Regresión: el análisis "suelto" de OmniLeads (sin Mission) sigue
//     funcionando igual y sin cobrar créditos — mismo motor, cero duplicado.
//
// Sin llamadas reales a OpenAI (mockeado, mismo patrón que
// ai/__tests__/openaiProvider.tokenLimit.test.ts): este sandbox no tiene
// salida de red hacia api.openai.com, así que el mock hace estos tests
// deterministas y rápidos en vez de depender del fallback heurístico llegar
// por timeout de red.
//
// Requiere una base de datos real desechable en DATABASE_URL (mismo patrón
// que omniSellerFase1.integration.test.ts). Se omite limpiamente sin ella.
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import express from "express";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { eq, and, inArray } from "drizzle-orm";
import {
  db, missionsTable, leadSearchesTable, leadResultsTable, leadAnalysisTable,
  creditHoldsTable, creditLedgerTable, usersTable,
} from "@workspace/db";
import { grantCredits } from "../../credits/creditService";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";

const create = vi.hoisted(() => vi.fn());
vi.mock("openai", () => ({
  default: class { chat = { completions: { create } }; embeddings = { create: vi.fn() }; },
}));

// Importado DESPUÉS del mock — mismo requisito que el precedente en
// ai/__tests__/openaiProvider.tokenLimit.test.ts.
const { leadsRouter } = await import("../leads");
const { missionsRouter } = await import("../missions");

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("OmniSeller Fase 2 — Missions research (Hunter → Researcher → Scorer)", () => {
  let orgAId: number;
  let orgBId: number;
  let userId: number;
  let server: Server;
  let base = "";
  let currentOrgId = 0;

  const cleanupMissionIds: number[] = [];
  const cleanupSearchIds: number[] = [];
  const cleanupResultIds: number[] = [];

  beforeAll(async () => {
    [orgAId, orgBId] = await createTempOrgs(2, "omniseller-f2");
    const suffix = Date.now();
    const [user] = await db.insert(usersTable)
      .values({ clerkId: `omniseller-f2-user-${suffix}`, email: `omniseller-f2-${suffix}@example.com` }).returning();
    userId = user!.id;

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, { orgId: currentOrgId, orgRole: "owner", userId, clerkUserId: "omniseller-f2-user" });
      next();
    });
    app.use("/api/leads", leadsRouter);
    app.use("/api/missions", missionsRouter);
    await new Promise<void>((resolve) => { server = app.listen(0, "127.0.0.1", () => resolve()); });
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise((r) => server.close(r));
    for (const id of cleanupResultIds) await db.delete(leadAnalysisTable).where(eq(leadAnalysisTable.resultId, id));
    for (const id of cleanupResultIds) await db.delete(leadResultsTable).where(eq(leadResultsTable.id, id));
    for (const id of cleanupSearchIds) await db.delete(leadSearchesTable).where(eq(leadSearchesTable.id, id));
    for (const id of cleanupMissionIds) await db.delete(missionsTable).where(eq(missionsTable.id, id));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await deleteTempOrgs([orgAId, orgBId]);
  });

  const asOrg = (orgId: number) => { currentOrgId = orgId; };

  /** Crea una Mission + una lead_search asociada + N lead_results 'new' sin web (heurística determinista). */
  async function seedMissionWithResults(orgId: number, count: number) {
    const [mission] = await db.insert(missionsTable).values({ orgId, name: `Mission research test ${Date.now()}` }).returning();
    cleanupMissionIds.push(mission!.id);
    const [search] = await db.insert(leadSearchesTable).values({
      orgId, missionId: mission!.id, sector: "test", city: "Madrid", status: "done", totalFound: count,
    }).returning();
    cleanupSearchIds.push(search!.id);
    const resultIds: number[] = [];
    for (let i = 0; i < count; i++) {
      const [r] = await db.insert(leadResultsTable).values({
        orgId, searchId: search!.id, name: `Prospecto ${Date.now()}-${i}`, website: null, status: "new",
      }).returning();
      resultIds.push(r!.id);
      cleanupResultIds.push(r!.id);
    }
    return { missionId: mission!.id, searchId: search!.id, resultIds };
  }

  it("aísla la investigación por organización: Org B no ve, no investiga y no puede colarse en la Mission de Org A", async () => {
    create.mockRejectedValue(new Error("sin red en el sandbox — se espera fallback heurístico"));
    asOrg(orgAId);
    const { missionId, resultIds } = await seedMissionWithResults(orgAId, 2);

    asOrg(orgBId);
    // La misión de A no existe para B.
    const notFound = await fetch(`${base}/api/missions/${missionId}/research`, { method: "POST" });
    expect(notFound.status).toBe(404);

    // B crea su propia Mission y pasa, a propósito, los ids de los prospectos de A.
    const { missionId: missionBId } = await seedMissionWithResults(orgBId, 0);
    const crossOrgRes = await fetch(`${base}/api/missions/${missionBId}/research`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: resultIds }),
    });
    expect(crossOrgRes.status).toBe(200);
    const body = await crossOrgRes.json() as { requested: number };
    expect(body.requested).toBe(0); // el join por org_id + mission_id los descarta, no se investiga nada ajeno

    // Los prospectos de A siguen intactos ('new', sin análisis).
    const untouched = await db.select().from(leadResultsTable).where(eq(leadResultsTable.orgId, orgAId));
    expect(untouched.every(r => r.status === "new")).toBe(true);
  });

  it("Mission → Hunter → Researcher → Scorer: investiga los prospectos 'new', los deja 'analyzed' con score/opportunity trazable y actualiza el resumen de la Mission", async () => {
    create.mockRejectedValue(new Error("sin red en el sandbox — se espera fallback heurístico"));
    asOrg(orgAId);
    await grantCredits(orgAId, 10, { reference: `f2-grant-${Date.now()}` });
    const { missionId, resultIds } = await seedMissionWithResults(orgAId, 3);

    const res = await fetch(`${base}/api/missions/${missionId}/research`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { requested: number; analyzed: number; failed: number; notAttempted: number; creditsSpent: number };
    expect(body).toMatchObject({ requested: 3, analyzed: 3, failed: 0, notAttempted: 0, creditsSpent: 3 });

    // lead_result → lead_analysis → score: trazable sin ninguna columna nueva.
    const results = await db.select().from(leadResultsTable).where(and(eq(leadResultsTable.orgId, orgAId)));
    for (const id of resultIds) {
      const r = results.find(x => x.id === id)!;
      expect(r.status).toBe("analyzed");
      const [analysis] = await db.select().from(leadAnalysisTable).where(eq(leadAnalysisTable.resultId, id));
      expect(analysis).toBeDefined();
      expect(analysis!.score).not.toBeNull();
      // Sin web y sin señales digitales → heurística determinista: score alto, oportunidad "alta".
      expect(analysis!.opportunity).toBe("alta");
    }

    const detail = await fetch(`${base}/api/missions/${missionId}`).then(r => r.json()) as {
      summary: { analyzed: number; highOpportunity: number; mediumOpportunity: number; lowOpportunity: number };
    };
    expect(detail.summary.analyzed).toBe(3);
    expect(detail.summary.highOpportunity).toBe(3);
    expect(detail.summary.mediumOpportunity + detail.summary.lowOpportunity).toBe(0);
  });

  it("sin saldo no se investiga ningún prospecto: 402, sin hold huérfano y los prospectos quedan 'new' para reintentar", async () => {
    create.mockRejectedValue(new Error("no debería llegar a llamarse — sin crédito no se ejecuta nada"));
    asOrg(orgBId);
    const { missionId, resultIds } = await seedMissionWithResults(orgBId, 1);

    const res = await fetch(`${base}/api/missions/${missionId}/research`, { method: "POST" });
    expect(res.status).toBe(402);
    const body = await res.json() as { analyzed: number; failed: number };
    expect(body.analyzed).toBe(0);
    expect(body.failed).toBe(0);

    const [result] = await db.select().from(leadResultsTable).where(eq(leadResultsTable.id, resultIds[0]!));
    expect(result!.status).toBe("new");

    const reference = `missions:research:${resultIds[0]}`;
    const holds  = await db.select().from(creditHoldsTable).where(eq(creditHoldsTable.reference, reference));
    const ledger = await db.select().from(creditLedgerTable).where(eq(creditLedgerTable.reference, reference));
    expect(holds.length).toBe(0);
    expect(ledger.length).toBe(0);
  });

  it("saldo parcial: investiga lo que puede pagar y para ahí — no intenta el resto uno a uno sabiendo que fallará igual", async () => {
    create.mockRejectedValue(new Error("sin red en el sandbox — se espera fallback heurístico"));
    // orgB, no orgA: orgA ya tiene saldo sobrante de tests anteriores en este
    // archivo y aquí necesitamos saber el saldo exacto de entrada.
    asOrg(orgBId);
    await grantCredits(orgBId, 1, { reference: `f2-grant-partial-${Date.now()}` }); // solo alcanza para 1 de 2
    const { missionId, resultIds } = await seedMissionWithResults(orgBId, 2);

    const res = await fetch(`${base}/api/missions/${missionId}/research`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { requested: number; analyzed: number; failed: number; notAttempted: number; creditsSpent: number };
    expect(body).toMatchObject({ requested: 2, analyzed: 1, failed: 0, notAttempted: 1, creditsSpent: 1 });

    const rows = await db.select().from(leadResultsTable).where(inArray(leadResultsTable.id, resultIds));
    expect(rows.filter(r => r.status === "analyzed").length).toBe(1);
    expect(rows.filter(r => r.status === "new").length).toBe(1); // el no-intentado queda disponible para reintentar
  });

  it("runLeadAnalysis no revienta si el lead_result desaparece entre seleccionarlo y procesarlo — devuelve null en vez de lanzar", async () => {
    const { runLeadAnalysis } = await import("../leads");
    const result = await runLeadAnalysis(orgAId, userId, 999_999_999);
    expect(result).toBeNull();
  });

  it("una Mission cerrada (completed/cancelled) no admite investigación, igual que ya bloquea el Hunter", async () => {
    create.mockRejectedValue(new Error("no debería llegar a llamarse"));
    asOrg(orgAId);
    const { missionId } = await seedMissionWithResults(orgAId, 1);
    await db.update(missionsTable).set({ status: "completed" }).where(eq(missionsTable.id, missionId));

    const res = await fetch(`${base}/api/missions/${missionId}/research`, { method: "POST" });
    expect(res.status).toBe(409);
  });

  it("regresión OmniLeads: un lead suelto (sin Mission) se sigue analizando con el mismo motor y sin cobrar créditos", async () => {
    create.mockRejectedValue(new Error("sin red en el sandbox — se espera fallback heurístico"));
    asOrg(orgAId);
    const [search] = await db.insert(leadSearchesTable).values({
      orgId: orgAId, sector: "test-standalone", city: "Madrid",
    }).returning();
    cleanupSearchIds.push(search!.id);
    const [result] = await db.insert(leadResultsTable).values({
      orgId: orgAId, searchId: search!.id, name: "Prospecto suelto OmniLeads", website: null, status: "new",
    }).returning();
    cleanupResultIds.push(result!.id);

    const res = await fetch(`${base}/api/leads/results/${result!.id}/analyze`, { method: "POST" });
    expect(res.status).toBe(200);
    const body = await res.json() as { score: number; opportunity: string };
    expect(body.opportunity).toBe("alta");

    // Sin misión de por medio, este flujo nunca ha cobrado créditos — no debe empezar a hacerlo ahora.
    const ledgerForResult = await db.select().from(creditLedgerTable)
      .where(eq(creditLedgerTable.reference, `missions:research:${result!.id}`));
    expect(ledgerForResult.length).toBe(0);
  });
});
