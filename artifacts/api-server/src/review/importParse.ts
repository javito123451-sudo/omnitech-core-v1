// Lectura de ficheros de contactos (CSV y XLSX) con las librerías que ya usa el repo
// (csv-parse, exceljs). Devuelve filas como objetos cabecera → valor.
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";

export const MAX_IMPORT_ROWS = 20_000;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

export class ImportFileError extends Error {
  constructor(message: string, public readonly code: "empty" | "too_many_rows" | "unreadable" | "unsupported") { super(message); this.name = "ImportFileError"; }
}

export interface ParsedFile { headers: string[]; rows: Record<string, unknown>[] }

function detectDelimiter(firstLine: string): string {
  const counts = [",", ";", "\t", "|"].map((d) => [d, firstLine.split(d).length - 1] as const);
  return counts.sort((a, b) => b[1] - a[1])[0]![1] > 0 ? counts.sort((a, b) => b[1] - a[1])[0]![0] : ",";
}

export function parseCsv(buf: Buffer): ParsedFile {
  let text = buf.toString("utf8");
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  if (text.trim() === "") throw new ImportFileError("El archivo está vacío.", "empty");
  let records: Record<string, string>[];
  try {
    records = parse(text, {
      columns: (h: string[]) => h.map((x) => x.trim()),
      delimiter: detectDelimiter(text.split(/\r?\n/, 1)[0] ?? ""),
      skip_empty_lines: true, relax_column_count: true, trim: true, bom: true,
    }) as Record<string, string>[];
  } catch (e) {
    throw new ImportFileError(`No se pudo leer el CSV: ${(e as Error).message}`, "unreadable");
  }
  if (records.length === 0) throw new ImportFileError("El archivo no contiene filas de datos.", "empty");
  if (records.length > MAX_IMPORT_ROWS) throw new ImportFileError(`Máximo ${MAX_IMPORT_ROWS} filas por importación.`, "too_many_rows");
  return { headers: Object.keys(records[0]!), rows: records };
}

function cellValue(v: ExcelJS.CellValue): unknown {
  if (v == null) return null;
  if (typeof v === "object" && !(v instanceof Date)) {
    const o = v as { text?: string; result?: unknown; hyperlink?: string; richText?: { text: string }[] };
    if (o.richText) return o.richText.map((r) => r.text).join("");
    if (o.text !== undefined) return o.text;
    if (o.result !== undefined) return o.result;
    return null;
  }
  return v;
}

export async function parseXlsx(buf: Buffer): Promise<ParsedFile> {
  const wb = new ExcelJS.Workbook();
  try { await wb.xlsx.load(buf as unknown as ArrayBuffer); }
  catch (e) { throw new ImportFileError(`No se pudo leer el Excel: ${(e as Error).message}`, "unreadable"); }
  const ws = wb.worksheets[0];
  if (!ws || ws.rowCount < 2) throw new ImportFileError("El archivo no contiene filas de datos.", "empty");
  if (ws.rowCount - 1 > MAX_IMPORT_ROWS) throw new ImportFileError(`Máximo ${MAX_IMPORT_ROWS} filas por importación.`, "too_many_rows");
  const headers: string[] = [];
  ws.getRow(1).eachCell({ includeEmpty: true }, (c, i) => { headers[i - 1] = String(cellValue(c.value) ?? "").trim(); });
  const rows: Record<string, unknown>[] = [];
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r);
    const obj: Record<string, unknown> = {};
    let any = false;
    headers.forEach((h, i) => { if (!h) return; const v = cellValue(row.getCell(i + 1).value); if (v !== null && v !== "") any = true; obj[h] = v; });
    if (any) rows.push(obj);
  }
  if (rows.length === 0) throw new ImportFileError("El archivo no contiene filas de datos.", "empty");
  return { headers: headers.filter(Boolean), rows };
}

export async function parseContactsFile(fileName: string, buf: Buffer): Promise<{ source: "csv" | "xlsx"; parsed: ParsedFile }> {
  const ext = fileName.toLowerCase().split(".").pop();
  if (ext === "csv" || ext === "txt") return { source: "csv", parsed: parseCsv(buf) };
  if (ext === "xlsx") return { source: "xlsx", parsed: await parseXlsx(buf) };
  throw new ImportFileError("Formato no soportado. Usa .csv o .xlsx (convierte los .xls antes).", "unsupported");
}
