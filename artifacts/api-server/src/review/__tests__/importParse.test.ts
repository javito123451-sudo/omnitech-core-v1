import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import { ImportFileError, MAX_IMPORT_ROWS, parseContactsFile, parseCsv, parseXlsx } from "../importParse";

describe("parseCsv", () => {
  it("coma, punto y coma y tabulador; BOM; comillas con separadores dentro", () => {
    const csv = "﻿Nombre;Email;Teléfono\n\"García, Ana\";ana@x.es;600111222\nLuis;luis@x.es;\n";
    const p = parseCsv(Buffer.from(csv));
    expect(p.headers).toEqual(["Nombre", "Email", "Teléfono"]);
    expect(p.rows).toHaveLength(2); expect(p.rows[0]!["Nombre"]).toBe("García, Ana");
    expect(parseCsv(Buffer.from("a\tb\n1\t2")).rows[0]).toEqual({ a: "1", b: "2" });
  });
  it("archivo vacío o solo cabecera → ImportFileError(empty)", () => {
    expect(() => parseCsv(Buffer.from(""))).toThrow(ImportFileError);
    expect(() => parseCsv(Buffer.from("email,tel\n"))).toThrow(/no contiene filas/);
  });
  it(`más de ${MAX_IMPORT_ROWS} filas → too_many_rows`, () => {
    const big = "email\n" + Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => `u${i}@x.es`).join("\n");
    expect(() => parseCsv(Buffer.from(big))).toThrow(/Máximo/);
  });
});

describe("parseXlsx / parseContactsFile", () => {
  async function xlsx(rows: unknown[][]): Promise<Buffer> {
    const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet("c"); rows.forEach((r) => ws.addRow(r));
    return Buffer.from(await wb.xlsx.writeBuffer());
  }
  it("lee celdas de texto, número, fecha y enlace de email", async () => {
    const buf = await xlsx([["Nombre", "Email", "Teléfono", "Fecha"], ["Ana", { text: "ana@x.es", hyperlink: "mailto:ana@x.es" }, 600111222, new Date("2026-03-15T00:00:00Z")], [null, null, null, null], ["Luis", "luis@x.es", "611222333", "15/03/2026"]]);
    const p = await parseXlsx(buf);
    expect(p.headers).toEqual(["Nombre", "Email", "Teléfono", "Fecha"]);
    expect(p.rows).toHaveLength(2);
    expect(p.rows[0]).toMatchObject({ Nombre: "Ana", Email: "ana@x.es", Teléfono: 600111222 });
  });
  it("detecta formato por extensión; .xls y desconocidos se rechazan; XLSX corrupto → unreadable", async () => {
    expect((await parseContactsFile("a.CSV", Buffer.from("email\na@b.es"))).source).toBe("csv");
    expect((await parseContactsFile("a.xlsx", await xlsx([["email"], ["a@b.es"]]))).source).toBe("xlsx");
    await expect(parseContactsFile("a.xls", Buffer.from("x"))).rejects.toMatchObject({ code: "unsupported" });
    await expect(parseContactsFile("a.xlsx", Buffer.from("no es un zip"))).rejects.toMatchObject({ code: "unreadable" });
  });
});
