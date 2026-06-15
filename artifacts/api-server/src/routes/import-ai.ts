import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import { createRequire } from "module";
import { writeFileSync, unlinkSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { db } from "@workspace/db";
import { clientsTable, activityTable } from "@workspace/db";
import { eq, and, ilike, sql } from "drizzle-orm";
import { logAiCall } from "../utils/aiUsageLogger";
import { logAudit } from "../utils/auditLogger";

// CJS interop: pdf-parse v2 uses class-based API (requires a file path URL, not buffer)
const _require = createRequire(import.meta.url);
const { PDFParse } = _require("pdf-parse") as {
  PDFParse: new (opts: Record<string, unknown>) => { getText: () => Promise<{ text: string; totalPages: number }> };
};

async function parsePdfBuffer(buf: Buffer): Promise<string> {
  const tmpPath = join(tmpdir(), `omni_pdf_${Date.now()}_${Math.random().toString(36).slice(2)}.pdf`);
  writeFileSync(tmpPath, buf);
  try {
    const parser = new PDFParse({ url: tmpPath, verbosity: 0 });
    const result = await parser.getText();
    return result.text;
  } finally {
    try { unlinkSync(tmpPath); } catch { /* ignore */ }
  }
}

export const importAiRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
});

const IMAGE_EXTS       = new Set(["jpg", "jpeg", "png", "webp", "gif", "heic"]);
const DOCUMENT_EXTS    = new Set(["pdf"]);
const SPREADSHEET_EXTS = new Set(["xlsx", "xls"]);
const CSV_EXTS         = new Set(["csv"]);

function getExt(filename: string): string {
  return (filename.split(".").pop() ?? "").toLowerCase();
}
function mimeForExt(ext: string): string {
  const map: Record<string, string> = {
    jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
    webp: "image/webp", gif: "image/gif", heic: "image/heic",
  };
  return map[ext] ?? "image/jpeg";
}

// ── Prompt 1: Full extraction (images / PDFs / small files) ──────────────────
const FULL_EXTRACTION_PROMPT = `Eres un experto en extracción de datos empresariales. Analiza el contenido y devuelve SOLO JSON válido sin markdown:

{
  "detected_type": "<contact|contact_list|invoice|contract|quote|lead|business_card|internal_document|other>",
  "confidence": <0-100>,
  "suggested_destination": "<CRM|Documentos|CRM + Documentos|Leads>",
  "summary": "<resumen en español, 1-2 frases>",
  "records": [
    {
      "name": "<nombre completo o null>",
      "email": "<email o null>",
      "phone": "<teléfono o null>",
      "company": "<empresa o null>",
      "position": "<cargo o null>",
      "address": "<dirección o null>",
      "website": "<web o null>",
      "cif": "<CIF/NIF o null>",
      "notes": "<notas relevantes o null>",
      "value": <número EUR o null>,
      "tags": "<tags separados por coma o null>",
      "status": "<lead|client|prospect>"
    }
  ]
}

REGLAS: Devuelve SOLO JSON sin bloques de código. Para listas de contactos incluye TODOS los registros. Si no extraes un campo ponlo null.`;

// ── Prompt 2: Column mapping only (Excel/CSV with many rows) ─────────────────
const COLUMN_MAPPING_PROMPT = `Analiza estas filas de muestra de un archivo de datos y devuelve SOLO JSON sin markdown:

{
  "detected_type": "<contact_list|invoice|contract|quote|lead|other>",
  "confidence": <0-100>,
  "suggested_destination": "<CRM|Documentos|CRM + Documentos|Leads>",
  "summary": "<resumen en español, 1-2 frases>",
  "column_mapping": {
    "name":     "<nombre exacto de la columna que contiene el nombre completo, o null>",
    "email":    "<nombre exacto de la columna de email, o null>",
    "phone":    "<nombre exacto de la columna de teléfono, o null>",
    "company":  "<nombre exacto de la columna de empresa, o null>",
    "position": "<nombre exacto de la columna de cargo, o null>",
    "address":  "<nombre exacto de la columna de dirección, o null o 'COMBINE:Col1+Col2+Col3' para combinar varias>",
    "website":  "<nombre exacto de la columna de web, o null>",
    "cif":      "<nombre exacto de la columna de CIF/NIF, o null>",
    "notes":    "<nombre exacto de la columna de notas, o null>",
    "value":    "<nombre exacto de la columna de valor económico, o null>",
    "tags":     "<nombre exacto de la columna de etiquetas, o null>",
    "status":   "<nombre exacto de la columna de estado, o null>"
  },
  "status_mapping": {
    "<valor original como Activo/Inactivo/Lead/etc>": "<lead|client|prospect>"
  }
}

REGLAS: Devuelve SOLO JSON sin bloques de código. El campo column_mapping debe contener los nombres EXACTOS de las columnas tal como aparecen en los datos de muestra.`;

// ── Apply column mapping to all rows (no AI cost) ─────────────────────────────
function applyColumnMapping(
  rows: Record<string, unknown>[],
  mapping: Record<string, string | null>,
  statusMapping: Record<string, string>,
): Array<Record<string, unknown>> {
  return rows.map(row => {
    const get = (col: string | null | undefined): string | null => {
      if (!col) return null;
      if (col.startsWith("COMBINE:")) {
        const parts = col.replace("COMBINE:", "").split("+");
        const combined = parts.map(p => String(row[p.trim()] ?? "").trim()).filter(Boolean).join(", ");
        return combined || null;
      }
      const val = row[col];
      if (val === null || val === undefined || val === "") return null;
      return String(val).trim();
    };

    const rawStatus = get(mapping["status"]);
    const mappedStatus = rawStatus
      ? (statusMapping[rawStatus] ?? statusMapping[rawStatus.toLowerCase()] ?? "lead")
      : "lead";

    const rawValue = get(mapping["value"]);
    const numValue = rawValue ? parseFloat(rawValue.replace(/[^0-9.,]/g, "").replace(",", ".")) : null;

    return {
      name:     get(mapping["name"]),
      email:    get(mapping["email"]),
      phone:    get(mapping["phone"]),
      company:  get(mapping["company"]),
      position: get(mapping["position"]),
      address:  get(mapping["address"]),
      website:  get(mapping["website"]),
      cif:      get(mapping["cif"]),
      notes:    get(mapping["notes"]),
      value:    Number.isNaN(numValue) ? null : numValue,
      tags:     get(mapping["tags"]),
      status:   mappedStatus,
    };
  });
}

// ── analyzeWithAI — full extraction (images, PDFs, small text) ────────────────
async function analyzeWithAI(
  openai: OpenAI,
  content: { type: "image"; b64: string; mime: string } | { type: "text"; text: string },
  orgId: number,
  clerkUserId: string | null,
): Promise<Record<string, unknown>> {
  const t0 = Date.now();

  console.log("[ImportAI][AI-FULL] REQUEST", {
    mode: content.type,
    textLen: content.type === "text" ? content.text.length : undefined,
  });

  const userContent: OpenAI.Chat.ChatCompletionMessageParam["content"] =
    content.type === "image"
      ? [
          { type: "image_url" as const, image_url: { url: `data:${content.mime};base64,${content.b64}`, detail: "high" as const } },
          { type: "text" as const, text: "Extrae toda la información. Devuelve SOLO el JSON." },
        ]
      : `Extrae toda la información del siguiente contenido:\n\n${content.text}`;

  let completion: OpenAI.Chat.ChatCompletion;
  try {
    completion = await openai.chat.completions.create({
      model:           "gpt-4o",
      messages:        [
        { role: "system", content: FULL_EXTRACTION_PROMPT },
        { role: "user",   content: userContent },
      ],
      temperature:     0.1,
      max_tokens:      16000,
      response_format: { type: "json_object" },
    });
  } catch (err) {
    console.error("[ImportAI][AI-FULL-ERR]", (err as Error).message);
    throw err;
  }

  const rawContent   = completion.choices[0]?.message?.content ?? null;
  const finishReason = completion.choices[0]?.finish_reason ?? null;
  const tokensIn     = completion.usage?.prompt_tokens    ?? 0;
  const tokensOut    = completion.usage?.completion_tokens ?? 0;

  console.log("[ImportAI][AI-FULL] RESPONSE", { finishReason, tokensIn, tokensOut, rawLen: rawContent?.length });

  if (finishReason === "length") {
    console.warn("[ImportAI][AI-FULL] TRUNCATED — response cut by max_tokens, attempting partial parse");
  }

  try {
    const parsed = JSON.parse(rawContent ?? "{}") as Record<string, unknown>;
    console.log("[ImportAI][AI-FULL] PARSE OK", {
      detected_type: parsed.detected_type,
      records: Array.isArray(parsed.records) ? (parsed.records as unknown[]).length : "NOT_ARRAY",
    });
    logAiCall({ orgId, userClerkId: clerkUserId, functionName: "import_ai_analysis", model: "gpt-4o", tokensInput: tokensIn, tokensOutput: tokensOut, durationMs: Date.now() - t0 }).catch(() => {});
    return parsed;
  } catch {
    console.error("[ImportAI][AI-FULL] JSON PARSE FAILED", { rawContent: rawContent?.slice(0, 300) });
    return { detected_type: "other", confidence: 0, records: [], summary: "Error al analizar el documento" };
  }
}

// ── detectColumnMapping — AI on sample rows only ──────────────────────────────
async function detectColumnMapping(
  openai: OpenAI,
  sampleRows: Record<string, unknown>[],
  orgId: number,
  clerkUserId: string | null,
): Promise<{
  detected_type: string; confidence: number;
  suggested_destination: string; summary: string;
  column_mapping: Record<string, string | null>;
  status_mapping: Record<string, string>;
}> {
  const t0 = Date.now();
  const sampleText = JSON.stringify(sampleRows, null, 2);

  console.log("[ImportAI][AI-MAPPING] Sending", sampleRows.length, "sample rows, cols:", Object.keys(sampleRows[0] ?? {}));

  let completion: OpenAI.Chat.ChatCompletion;
  try {
    completion = await openai.chat.completions.create({
      model:           "gpt-4o",
      messages:        [
        { role: "system", content: COLUMN_MAPPING_PROMPT },
        { role: "user",   content: `Filas de muestra:\n${sampleText}` },
      ],
      temperature:     0.1,
      max_tokens:      1000,
      response_format: { type: "json_object" },
    });
  } catch (err) {
    console.error("[ImportAI][AI-MAPPING-ERR]", (err as Error).message);
    throw err;
  }

  const rawContent = completion.choices[0]?.message?.content ?? null;
  const tokensIn   = completion.usage?.prompt_tokens    ?? 0;
  const tokensOut  = completion.usage?.completion_tokens ?? 0;

  console.log("[ImportAI][AI-MAPPING] RESPONSE", { tokensIn, tokensOut, raw: rawContent?.slice(0, 400) });

  logAiCall({ orgId, userClerkId: clerkUserId, functionName: "import_ai_analysis", model: "gpt-4o", tokensInput: tokensIn, tokensOutput: tokensOut, durationMs: Date.now() - t0 }).catch(() => {});

  try {
    const parsed = JSON.parse(rawContent ?? "{}") as Record<string, unknown>;
    return {
      detected_type:        String(parsed.detected_type ?? "contact_list"),
      confidence:           Number(parsed.confidence ?? 80),
      suggested_destination: String(parsed.suggested_destination ?? "CRM"),
      summary:              String(parsed.summary ?? ""),
      column_mapping:       (parsed.column_mapping as Record<string, string | null>) ?? {},
      status_mapping:       (parsed.status_mapping as Record<string, string>) ?? {},
    };
  } catch {
    console.error("[ImportAI][AI-MAPPING] PARSE FAILED");
    return {
      detected_type: "contact_list", confidence: 70,
      suggested_destination: "CRM", summary: "Lista de contactos",
      column_mapping: {}, status_mapping: {},
    };
  }
}

// ── POST /upload ──────────────────────────────────────────────────────────────
importAiRouter.post("/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: "No se ha enviado ningún archivo" }); return; }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) { res.status(503).json({ error: "OPENAI_API_KEY no configurada" }); return; }

  const orgId       = (req as typeof req & { orgId?: number }).orgId ?? 1;
  const clerkUserId = (req as typeof req & { clerkUserId?: string }).clerkUserId ?? null;
  const ext         = getExt(file.originalname);
  const openai      = new OpenAI({ apiKey });
  let rawTextForDB  = "";

  console.log("[ImportAI][1] FILE RECEIVED", {
    name: file.originalname, size: file.size, ext, orgId,
  });

  const branch = IMAGE_EXTS.has(ext) ? "IMAGE"
    : DOCUMENT_EXTS.has(ext)         ? "PDF"
    : SPREADSHEET_EXTS.has(ext)      ? "XLSX"
    : CSV_EXTS.has(ext)              ? "CSV"
    : "PLAIN_TEXT";

  console.log("[ImportAI][2] BRANCH →", branch);

  try {
    let result: Record<string, unknown>;

    // ── IMAGE ────────────────────────────────────────────────────────────────
    if (branch === "IMAGE") {
      result = await analyzeWithAI(openai,
        { type: "image", b64: file.buffer.toString("base64"), mime: mimeForExt(ext) },
        orgId, clerkUserId);

    // ── PDF ──────────────────────────────────────────────────────────────────
    } else if (branch === "PDF") {
      rawTextForDB = await parsePdfBuffer(file.buffer);
      console.log("[ImportAI][PDF] Extracted", rawTextForDB.length, "chars");
      result = await analyzeWithAI(openai, { type: "text", text: rawTextForDB }, orgId, clerkUserId);

    // ── XLSX/XLS — HYBRID: AI column mapping + client-side row mapping ────────
    } else if (branch === "XLSX") {
      let XLSX: typeof import("xlsx");
      XLSX = await import("xlsx");
      const wb   = XLSX.read(file.buffer, { type: "buffer" });
      const ws   = wb.Sheets[wb.SheetNames[0]!];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws!, { defval: "" });

      console.log("[ImportAI][XLSX] Parsed", rows.length, "rows, cols:", Object.keys(rows[0] ?? {}));
      rawTextForDB = JSON.stringify(rows.slice(0, 5), null, 2);

      if (rows.length === 0) {
        result = { detected_type: "other", confidence: 0, records: [], summary: "El archivo está vacío", suggested_destination: "CRM" };
      } else if (rows.length <= 15) {
        // Small file — full AI extraction
        const text = `Excel con ${rows.length} filas:\n${JSON.stringify(rows, null, 2)}`;
        result = await analyzeWithAI(openai, { type: "text", text }, orgId, clerkUserId);
      } else {
        // Large file — AI maps columns using first 10 rows, Node.js maps the rest
        const sample     = rows.slice(0, 10);
        const mappingRes = await detectColumnMapping(openai, sample, orgId, clerkUserId);
        console.log("[ImportAI][XLSX] Column mapping:", mappingRes.column_mapping);
        const allRecords = applyColumnMapping(rows, mappingRes.column_mapping, mappingRes.status_mapping);
        console.log("[ImportAI][XLSX] Mapped", allRecords.length, "records");
        result = {
          detected_type:        mappingRes.detected_type,
          confidence:           mappingRes.confidence,
          suggested_destination: mappingRes.suggested_destination,
          summary:              mappingRes.summary + ` (${rows.length} registros detectados)`,
          records:              allRecords,
        };
      }

    // ── CSV — same hybrid approach ────────────────────────────────────────────
    } else if (branch === "CSV") {
      const csvText = file.buffer.toString("utf-8");
      rawTextForDB  = csvText.slice(0, 2000);

      // Parse CSV manually
      const lines  = csvText.split("\n").map(l => l.trim()).filter(Boolean);
      const header = lines[0]?.split(",").map(h => h.replace(/^"|"$/g, "").trim()) ?? [];
      const rows   = lines.slice(1).map(line => {
        const values = line.split(",").map(v => v.replace(/^"|"$/g, "").trim());
        const row: Record<string, unknown> = {};
        header.forEach((h, i) => { row[h] = values[i] ?? ""; });
        return row;
      });

      console.log("[ImportAI][CSV] Parsed", rows.length, "rows, cols:", header);

      if (rows.length === 0) {
        result = { detected_type: "other", confidence: 0, records: [], summary: "El CSV está vacío", suggested_destination: "CRM" };
      } else if (rows.length <= 15) {
        const text = `CSV con ${rows.length} filas:\n${JSON.stringify(rows, null, 2)}`;
        result = await analyzeWithAI(openai, { type: "text", text }, orgId, clerkUserId);
      } else {
        const sample     = rows.slice(0, 10);
        const mappingRes = await detectColumnMapping(openai, sample, orgId, clerkUserId);
        console.log("[ImportAI][CSV] Column mapping:", mappingRes.column_mapping);
        const allRecords = applyColumnMapping(rows, mappingRes.column_mapping, mappingRes.status_mapping);
        console.log("[ImportAI][CSV] Mapped", allRecords.length, "records");
        result = {
          detected_type:        mappingRes.detected_type,
          confidence:           mappingRes.confidence,
          suggested_destination: mappingRes.suggested_destination,
          summary:              mappingRes.summary + ` (${rows.length} registros detectados)`,
          records:              allRecords,
        };
      }

    // ── PLAIN TEXT / DOCX / OTHER ─────────────────────────────────────────────
    } else {
      const text   = file.buffer.toString("utf-8");
      rawTextForDB = text.slice(0, 2000);
      result = await analyzeWithAI(openai, { type: "text", text }, orgId, clerkUserId);
    }

    const detectedType  = String(result.detected_type ?? "other");
    const confidence    = Number(result.confidence   ?? 0);
    const suggestedDest = String(result.suggested_destination ?? "CRM");
    const recordCount   = Array.isArray(result.records) ? (result.records as unknown[]).length : 0;

    console.log("[ImportAI][DONE]", { detectedType, confidence, recordCount });

    await db.execute(sql`
      INSERT INTO import_jobs (org_id, user_clerk_id, status, file_name, file_type, detected_type, confidence_pct, raw_text, extracted_data, suggested_dest, records_created)
      VALUES (${orgId}, ${clerkUserId}, 'completed', ${file.originalname}, ${ext}, ${detectedType}, ${confidence}, ${rawTextForDB.slice(0, 2000) || null}, ${JSON.stringify(result)}::jsonb, ${suggestedDest}, ${recordCount})
    `);

    res.json({ ...result, fileName: file.originalname, fileType: ext });
  } catch (err) {
    console.error("[ImportAI][CATCH]", err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── POST /check-duplicates ────────────────────────────────────────────────────
importAiRouter.post("/check-duplicates", async (req, res) => {
  const { records } = req.body as { records: Array<{ email?: string; name?: string }> };
  const orgId = (req as typeof req & { orgId?: number }).orgId ?? 1;

  const results = await Promise.all(records.map(async r => {
    if (!r.email) return { hasDuplicate: false, existing: null };
    const existing = await db.select({ id: clientsTable.id, name: clientsTable.name, email: clientsTable.email })
      .from(clientsTable)
      .where(and(eq(clientsTable.orgId, orgId), ilike(clientsTable.email, r.email)))
      .limit(1);
    return { hasDuplicate: existing.length > 0, existing: existing[0] ?? null };
  }));

  res.json({ results });
});

// ── POST /confirm — save extracted data to CRM ────────────────────────────────
importAiRouter.post("/confirm", async (req, res) => {
  const { records } = req.body as {
    records: Array<{
      name?: string; email?: string; phone?: string; company?: string;
      position?: string; notes?: string; value?: number; tags?: string;
      status?: string; existingId?: number; skipImport?: boolean;
    }>;
  };
  const orgId       = (req as typeof req & { orgId?: number }).orgId ?? 1;
  const clerkUserId = (req as typeof req & { clerkUserId?: string }).clerkUserId ?? null;

  const results: Array<{ success: boolean; id?: number; name?: string; error?: string; action: string }> = [];
  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const record of records) {
    if (record.skipImport) { results.push({ success: true, action: "skipped" }); skipped++; continue; }

    const name  = record.name?.trim() || "Sin nombre";
    const email = record.email?.trim() ?? "";

    try {
      if (record.existingId) {
        await db.update(clientsTable)
          .set({
            name, email,
            phone:   record.phone   ?? null,
            company: record.company ?? null,
            notes:   record.notes   ?? null,
            tags:    record.tags    ?? null,
            value:   record.value   ?? null,
          })
          .where(and(eq(clientsTable.id, record.existingId), eq(clientsTable.orgId, orgId)));
        results.push({ success: true, id: record.existingId, name, action: "updated" });
        updated++;
      } else {
        const validStatuses = ["lead", "client", "prospect"] as const;
        const status = validStatuses.includes(record.status as typeof validStatuses[number])
          ? (record.status as typeof validStatuses[number])
          : "lead";

        const [newClient] = await db.insert(clientsTable)
          .values({
            orgId, name, email,
            phone:   record.phone   ?? null,
            company: record.company ?? null,
            status,
            notes:   record.notes   ?? null,
            tags:    record.tags    ?? null,
            value:   record.value   ?? null,
          })
          .returning({ id: clientsTable.id });

        if (newClient) {
          db.insert(activityTable).values({
            orgId, type: "client_added",
            description: `[Omni Import AI] ${name}${record.company ? ` (${record.company})` : ""}`,
            clientId:   newClient.id,
            createdBy:  clerkUserId ?? "import-ai",
          }).catch(() => {});
        }
        results.push({ success: true, id: newClient?.id, name, action: "created" });
        created++;
      }
    } catch (err) {
      console.error("[ImportAI][CONFIRM-ERR]", name, String(err));
      results.push({ success: false, name, error: String(err), action: "error" });
      errors++;
    }
  }

  // FIX: PostgreSQL doesn't support ORDER BY + LIMIT in UPDATE directly — use subquery
  db.execute(sql`
    UPDATE import_jobs
    SET records_created = ${created + updated},
        errors = ${errors > 0 ? String(errors) + ' errores' : null}
    WHERE id = (
      SELECT id FROM import_jobs
      WHERE org_id = ${orgId}
      ORDER BY created_at DESC
      LIMIT 1
    )
  `).catch(e => console.error("[ImportAI][UPDATE-JOB-ERR]", e.message));

  console.log("[ImportAI][CONFIRM] Done:", { created, updated, skipped, errors });

  logAudit({
    actorClerkId: clerkUserId ?? "unknown",
    action:    "import_completed",
    resource:  "import",
    orgId,
    details: {
      created, updated, skipped, errors,
      total:  results.length,
      result: errors > 0 ? "partial" : "success",
    },
    severity: errors > 0 ? "warning" : "info",
    result:   errors === results.length - skipped ? "failure" : "success",
    req,
  });

  res.json({ results, summary: { created, updated, skipped, errors, total: results.length } });
});

// ── GET /history ──────────────────────────────────────────────────────────────
importAiRouter.get("/history", async (req, res) => {
  const orgId = (req as typeof req & { orgId?: number }).orgId ?? 1;
  const rows  = await db.execute(sql`
    SELECT id, file_name, file_type, detected_type, confidence_pct, records_created, suggested_dest, created_at
    FROM import_jobs WHERE org_id=${orgId} ORDER BY created_at DESC LIMIT 50
  `);
  res.json((rows as { rows: unknown[] }).rows);
});

// ── GET /dashboard ────────────────────────────────────────────────────────────
importAiRouter.get("/dashboard", async (req, res) => {
  const orgId = (req as typeof req & { orgId?: number }).orgId ?? 1;

  const [totals, byType] = await Promise.all([
    db.execute(sql`
      SELECT COUNT(*)::int AS total_imports,
             COALESCE(SUM(records_created),0)::int AS total_records,
             COALESCE(SUM(CASE WHEN errors IS NOT NULL THEN 1 ELSE 0 END),0)::int AS total_errors
      FROM import_jobs WHERE org_id=${orgId}
    `),
    db.execute(sql`
      SELECT detected_type, COUNT(*)::int AS cnt
      FROM import_jobs WHERE org_id=${orgId}
      GROUP BY detected_type ORDER BY cnt DESC
    `),
  ]);

  const tot = ((totals as { rows: Array<Record<string, number>> }).rows[0]) ?? {};
  res.json({
    totalImports:  Number(tot.total_imports  ?? 0),
    totalRecords:  Number(tot.total_records  ?? 0),
    totalErrors:   Number(tot.total_errors   ?? 0),
    timeSavedMin:  Number(tot.total_records ?? 0) * 3,
    byType: (byType as { rows: Array<{ detected_type: string; cnt: number }> }).rows,
  });
});
