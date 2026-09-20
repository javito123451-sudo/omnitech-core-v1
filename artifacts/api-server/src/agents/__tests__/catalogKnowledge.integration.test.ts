// Aislamiento real del catálogo de knowledge contra Postgres (se omite sin DATABASE_URL de pruebas).
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db, knowledgeBaseTable } from "@workspace/db";
import { listKnowledgeCatalog } from "../catalogService";
import { createTempOrgs, deleteTempOrgs } from "../../test-utils/tempOrgs";

const hasRealDb = !process.env.DATABASE_URL?.includes("placeholder");

describe.skipIf(!hasRealDb)("catálogo de knowledge — aislamiento por workspace (Postgres)", () => {
  let orgs: number[] = [];
  let ids: { a1: number; a2: number; aOff: number; b1: number } = { a1: 0, a2: 0, aOff: 0, b1: 0 };

  beforeAll(async () => {
    orgs = await createTempOrgs(2, "catalog-kb");
    const [A, B] = orgs as [number, number];
    const rows = await db.insert(knowledgeBaseTable).values([
      { orgId: A, title: "A · horarios", content: "SECRETO-A-1", category: "general", sortOrder: 2 },
      { orgId: A, title: "A · precios", content: "SECRETO-A-2", category: "ventas", sortOrder: 1 },
      { orgId: A, title: "A · borrador", content: "SECRETO-A-3", category: "general", isActive: false },
      { orgId: B, title: "B · interno", content: "SECRETO-B-1", category: "rrhh" },
    ]).returning({ id: knowledgeBaseTable.id, title: knowledgeBaseTable.title });
    const idOf = (t: string) => rows.find((r) => r.title === t)!.id;
    ids = { a1: idOf("A · horarios"), a2: idOf("A · precios"), aOff: idOf("A · borrador"), b1: idOf("B · interno") };
  });
  afterAll(async () => { await deleteTempOrgs(orgs); });

  it("el workspace A ve solo lo suyo y activo, ordenado como el runtime; nunca lo de B ni contenido", async () => {
    const list = await listKnowledgeCatalog(orgs[0]!);
    expect(list.map((e) => e.id)).toEqual([ids.a2, ids.a1]);            // sortOrder 1, luego 2
    expect(list.map((e) => e.id)).not.toContain(ids.b1);
    expect(list.map((e) => e.id)).not.toContain(ids.aOff);              // inactiva: el runtime no la carga
    for (const e of list) expect(Object.keys(e).sort()).toEqual(["category", "id", "title"]);
    expect(JSON.stringify(list)).not.toMatch(/SECRETO|content/);
  });

  it("el workspace B ve solo lo suyo", async () => {
    const list = await listKnowledgeCatalog(orgs[1]!);
    expect(list.map((e) => e.id)).toEqual([ids.b1]);
    expect(JSON.stringify(list)).not.toContain("A ·");
  });

  it("un workspace sin entradas recibe una lista vacía", async () => {
    const [empty] = await createTempOrgs(1, "catalog-kb-empty");
    try { expect(await listKnowledgeCatalog(empty!)).toEqual([]); } finally { await deleteTempOrgs([empty!]); }
  });
});
