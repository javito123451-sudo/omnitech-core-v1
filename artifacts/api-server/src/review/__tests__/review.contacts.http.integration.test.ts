// Subida real de ficheros (multipart), permisos, aislamiento y rendimiento de /api/review/imports y /contacts.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import ExcelJS from "exceljs";
import { and, eq } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { reviewRouter } from "../routes";
import { cleanupOrgs, createOrg, hasRealDb, setModule, startApp, type Identity } from "./testHarness";

describe.skipIf(!hasRealDb)("/api/review imports y contactos — HTTP real + Postgres real", () => {
  let A = 0, B = 0, OFF = 0;
  let identity: Identity = {};
  let base = ""; let close: () => Promise<void>;
  beforeAll(async () => {
    [A, B, OFF] = [await createOrg("h-a"), await createOrg("h-b"), await createOrg("h-off")];
    await setModule(A, true); await setModule(B, true); await setModule(OFF, false);
    ({ base, close } = await startApp((app) => app.use("/api/review", reviewRouter), () => identity));
  });
  afterAll(async () => { await close(); await cleanupOrgs([A, B, OFF]); });

  const as = (orgId: number, role = "owner") => { identity = { orgId, role }; };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Res = Omit<Response, "json"> & { json(): Promise<any> };
  const get = (p: string) => fetch(`${base}/api/review${p}`) as Promise<Res>;
  const post = (p: string, body?: FormData | unknown) => fetch(`${base}/api/review${p}`, body instanceof FormData ? { method: "POST", body } : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) }) as Promise<Res>;
  const upload = (name: string, content: string | Buffer, fields: Record<string, string> = { legalBasis: "existing_customer_relationship" }) => {
    const fd = new FormData();
    fd.append("file", new Blob([typeof content === "string" ? content : new Uint8Array(content)]), name);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    return post("/imports", fd);
  };
  const CSV = "Nombre,Email,Teléfono,Servicio,Fecha\nAna,ana@h.es,600111222,Reparación,10/03/2026\nLuis,luis@h.es,,Mantenimiento,11/03/2026\nMala,xx,12,,\nAna dup,ANA@h.es,,,\n";

  it("CSV subido: 201 con recuento fiel, fila a fila, y los contactos quedan visibles solo para su empresa", async () => {
    as(A); const r = await upload("clientes.csv", CSV, { legalBasis: "consent", legalBasisNote: "Formulario web" });
    expect(r.status).toBe(201);
    const { import: imp } = await r.json();
    expect(imp).toMatchObject({ totalRows: 4, imported: 2, invalid: 1, duplicates: 1, withEmail: 2, withWhatsapp: 1 });
    const list = await (await get("/contacts")).json();
    expect(list.total).toBe(2);
    expect(list.contacts.map((c: { emailNorm: string }) => c.emailNorm).sort()).toEqual(["ana@h.es", "luis@h.es"]);
    as(B); expect((await (await get("/contacts")).json()).total).toBe(0);
  });

  it("XLSX subido (con teléfono numérico y fecha de Excel)", async () => {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("c");
    ws.addRow(["Nombre", "Email", "Teléfono", "Fecha"]); ws.addRow(["Eva", "eva@h.es", 611222333, new Date("2026-03-12T00:00:00Z")]);
    as(A); const r = await upload("clientes.xlsx", Buffer.from(await wb.xlsx.writeBuffer()));
    expect(r.status).toBe(201); expect((await r.json()).import).toMatchObject({ imported: 1, withWhatsapp: 1 });
  });

  it("el orgId enviado en el formulario se ignora: la empresa sale del contexto", async () => {
    as(B); const r = await upload("b.csv", "Email\nb1@h.es\n", { legalBasis: "consent", orgId: String(A) });
    expect(r.status).toBe(201);
    as(A); expect((await (await get("/contacts?q=b1@h.es")).json()).total).toBe(0);
    as(B); expect((await (await get("/contacts?q=b1@h.es")).json()).total).toBe(1);
  });

  it("errores de entrada claros: sin archivo 400, sin base jurídica 400, extensión 415, vacío 400, demasiado grande 413", async () => {
    as(A);
    expect((await post("/imports", new FormData())).status).toBe(400);
    const nb = await upload("a.csv", CSV, {}); expect(nb.status).toBe(400); expect((await nb.json()).error).toBe("legal_basis_required");
    expect((await upload("a.xls", "x")).status).toBe(415);
    expect((await upload("a.csv", "")).status).toBe(400);
    expect((await upload("grande.csv", "email\n" + "a@b.es\n".repeat(900_000))).status).toBe(413);
  });

  it("matriz de permisos: importar exige review.write; ver contactos review.read; suprimir datos review.admin", async () => {
    const f = (role: string) => { as(A, role); return upload(`${role}.csv`, `Email\n${role}@perm.es\n`); };
    for (const [role, status] of [["owner", 201], ["admin", 201], ["manager", 201], ["member", 403], ["vendedor", 403], ["read_only", 403], ["cliente", 403]] as const)
      expect((await f(role)).status, `import ${role}`).toBe(status);
    as(A, "owner"); const id = (await (await get("/contacts?q=owner@perm.es")).json()).contacts[0].id;
    for (const [role, status] of [["member", 200], ["read_only", 200], ["cliente", 403]] as const) { as(A, role); expect((await get("/contacts")).status, `list ${role}`).toBe(status); }
    as(A, "manager"); expect((await post(`/contacts/${id}/erase`)).status).toBe(403);
    as(A, "member"); expect((await post(`/contacts/${id}/unsubscribe`)).status).toBe(403);
  });

  it("módulo apagado → 403 antes de aceptar ningún fichero", async () => {
    as(OFF); const r = await upload("x.csv", CSV); expect(r.status).toBe(403); expect((await r.json()).error).toBe("module_disabled");
  });

  it("aislamiento: B no ve, consulta, da de baja ni suprime contactos e importaciones de A (404)", async () => {
    as(A); const contact = (await (await get("/contacts?q=ana@h.es")).json()).contacts[0];
    const imps = (await (await get("/imports")).json()).imports; expect(imps.length).toBeGreaterThan(0);
    as(B);
    expect((await get(`/contacts/${contact.id}`)).status).toBe(404);
    expect((await post(`/contacts/${contact.id}/unsubscribe`)).status).toBe(404);
    expect((await post(`/contacts/${contact.id}/erase`)).status).toBe(404);
    expect((await get(`/imports/${imps[0].id}`)).status).toBe(404);
    expect((await (await get("/imports")).json()).imports.some((i: { id: number }) => imps.some((a: { id: number }) => a.id === i.id))).toBe(false);
    as(A); expect((await get(`/contacts/${contact.id}`)).status).toBe(200); // intacto
  });

  it("ficha de contacto con su registro de consentimientos; baja y supresión por API con auditoría", async () => {
    as(A); const c = (await (await get("/contacts?q=luis@h.es")).json()).contacts[0];
    const detail = await (await get(`/contacts/${c.id}`)).json();
    expect(detail.consents).toHaveLength(1); expect(detail.consents[0]).toMatchObject({ channel: "email", legalBasis: "consent", revokedAt: null });
    expect((await post(`/contacts/${c.id}/unsubscribe`)).status).toBe(204);
    const after = await (await get(`/contacts/${c.id}`)).json();
    expect(after.contact.status).toBe("unsubscribed"); expect(after.consents[0].revokedAt).toBeTruthy();
    expect((await post(`/contacts/${c.id}/erase`)).status).toBe(204);
    const erased = await (await get(`/contacts/${c.id}`)).json();
    expect(erased.contact).toMatchObject({ status: "erased", name: null, emailNorm: null });
    await new Promise((r) => setTimeout(r, 100));
    for (const action of ["review.contacts_imported", "review.contact_unsubscribed", "review.contact_erased"]) {
      const rows = await db.select().from(auditLogsTable).where(and(eq(auditLogsTable.orgId, A), eq(auditLogsTable.action, action)));
      expect(rows.length, action).toBeGreaterThan(0);
    }
  });

  it("rendimiento: 5.000 contactos (3.000 con teléfono) se importan en una sola petición", async () => {
    const lines = ["Nombre,Email,Teléfono,Servicio,Fecha"];
    for (let i = 0; i < 5000; i++) lines.push(`Cliente ${i},cli${i}@perf.es,${i < 3000 ? `6${String(10000000 + i)}` : ""},Reparación,10/03/2026`);
    as(A); const t0 = Date.now();
    const r = await upload("perf.csv", lines.join("\n"));
    const ms = Date.now() - t0;
    expect(r.status).toBe(201);
    expect((await r.json()).import).toMatchObject({ totalRows: 5000, imported: 5000, invalid: 0, duplicates: 0, withEmail: 5000, withWhatsapp: 3000 });
    console.log(`[perf] importación de 5.000 contactos: ${ms} ms (Postgres local)`);
    expect(ms).toBeLessThan(30_000);
    // re-importar el mismo fichero: todo duplicado, nada se escribe
    const t1 = Date.now(); const again = await upload("perf.csv", lines.join("\n"));
    expect((await again.json()).import).toMatchObject({ imported: 0, duplicates: 5000 });
    console.log(`[perf] re-importación (5.000 duplicados): ${Date.now() - t1} ms`);
  }, 60_000);
});
