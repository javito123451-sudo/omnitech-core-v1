import { Router } from "express";
import multer from "multer";
import OpenAI from "openai";
import { db } from "@workspace/db";
import { clientsTable, activityTable } from "@workspace/db";
import { eq, and, ilike, sql } from "drizzle-orm";
import { logAiCall } from "../utils/aiUsageLogger";

export const importAiRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }, // 20MB max
});

// ── File type helpers ─────────────────────────────────────────────────────────
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

// ── AI extraction system prompt ───────────────────────────────────────────────
const SYSTEM_PROMPT = `Eres un experto en extracción de datos empresariales. Analiza el contenido y devuelve SOLO JSON válido:

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

REGLAS: Devuelve SOLO JSON. Para listas de contactos, incluye TODOS los registros. Si no extraes un campo, ponlo null.`;

async function analyzeWithAI(
  openai: OpenAI,
  content: { type: "image"; b64: string; mime: string } | { type: "text"; text: string },
  orgId: number,
  clerkUserId: string | null,
): Promise<Record<string, unknown>> {
  const t0 = Date.now();

  const userContent: OpenAI.Chat.ChatCompletionMessageParam["content"] =
    content.type === "image"
      ? [
          { type: "image_url" as const, image_url: { url: `data:${content.mime};base64,${content.b64}`, detail: "high" as const } },
          { type: "text" as const, text: "Extrae toda la información de esta imagen/documento. Devuelve SOLO el JSON." },
        ]
      : `Extrae toda la información del siguiente contenido:\n\n${content.text.slice(0, 8000)}`;

  const completion = await openai.chat.completions.create({
    model:           "gpt-4o",
    messages:        [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user",   content: userContent },
    ],
    temperature:     0.1,
    max_tokens:      2000,
    response_format: { type: "json_object" },
  });

  logAiCall({
    orgId, userClerkId: clerkUserId,
    functionName: "import_ai_analysis",
    model:        "gpt-4o",
    tokensInput:  completion.usage?.prompt_tokens    ?? 0,
    tokensOutput: completion.usage?.completion_tokens ?? 0,
    durationMs:   Date.now() - t0,
  }).catch(() => {});

  try {
    return JSON.parse(completion.choices[0]?.message?.content ?? "{}") as Record<string, unknown>;
  } catch {
    return { detected_type: "other", confidence: 0, records: [], summary: "Error al analizar el documento" };
  }
}

// ── POST /upload — main analysis endpoint ─────────────────────────────────────
importAiRouter.post("/upload", upload.single("file"), async (req, res) => {
  const file = req.file;
  if (!file) { res.status(400).json({ error: "No se ha enviado ningún archivo" }); return; }

  const apiKey = process.env["OPENAI_API_KEY"];
  if (!apiKey) { res.status(503).json({ error: "OPENAI_API_KEY no configurada" }); return; }

  const orgId       = (req as typeof req & { orgId?: number }).orgId ?? 1;
  const clerkUserId = (req as typeof req & { clerkUserId?: string }).clerkUserId ?? null;
  const ext         = getExt(file.originalname);
  const openai      = new OpenAI({ apiKey });
  let rawText       = "";

  try {
    let result: Record<string, unknown>;

    if (IMAGE_EXTS.has(ext)) {
      // Images → GPT-4o Vision
      result = await analyzeWithAI(openai,
        { type: "image", b64: file.buffer.toString("base64"), mime: mimeForExt(ext) },
        orgId, clerkUserId);

    } else if (DOCUMENT_EXTS.has(ext)) {
      // PDF → extract text → GPT-4o
      // pdf-parse is CJS: .default may be undefined on dynamic import — fall back to module root
      const pdfMod   = await import("pdf-parse");
      const pdfParse = (pdfMod.default ?? pdfMod) as (buf: Buffer) => Promise<{ text: string; numpages: number; info: Record<string, unknown> }>;
      const parsed   = await pdfParse(file.buffer);
      rawText        = parsed.text;
      result = await analyzeWithAI(openai, { type: "text", text: rawText }, orgId, clerkUserId);

    } else if (SPREADSHEET_EXTS.has(ext)) {
      // Excel → parse → GPT-4o
      const XLSX = await import("xlsx");
      const wb   = XLSX.read(file.buffer, { type: "buffer" });
      const ws   = wb.Sheets[wb.SheetNames[0]!];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws!, { defval: "" });
      rawText    = JSON.stringify(rows.slice(0, 200), null, 2);
      result = await analyzeWithAI(openai, { type: "text", text: `Excel/Hoja de cálculo con ${rows.length} filas:\n${rawText}` }, orgId, clerkUserId);

    } else if (CSV_EXTS.has(ext)) {
      // CSV → GPT-4o
      rawText = file.buffer.toString("utf-8");
      result = await analyzeWithAI(openai, { type: "text", text: `CSV:\n${rawText}` }, orgId, clerkUserId);

    } else {
      // Plain text / DOCX / TXT
      rawText = file.buffer.toString("utf-8");
      result = await analyzeWithAI(openai, { type: "text", text: rawText }, orgId, clerkUserId);
    }

    // Store import job
    const detectedType = String(result.detected_type ?? "other");
    const confidence   = Number(result.confidence   ?? 0);
    const suggestedDest = String(result.suggested_destination ?? "CRM");

    await db.execute(sql`
      INSERT INTO import_jobs (org_id, user_clerk_id, file_name, file_type, detected_type, confidence_pct, raw_text, extracted_data, suggested_dest)
      VALUES (${orgId}, ${clerkUserId}, ${file.originalname}, ${ext}, ${detectedType}, ${confidence}, ${rawText.slice(0, 2000) || null}, ${JSON.stringify(result)}::jsonb, ${suggestedDest})
    `);

    res.json({ ...result, fileName: file.originalname, fileType: ext });
  } catch (err) {
    console.error("[ImportAI] Upload error:", err);
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
  let created = 0, updated = 0, skipped = 0;

  for (const record of records) {
    if (record.skipImport) { results.push({ success: true, action: "skipped" }); skipped++; continue; }

    const name  = record.name?.trim() || "Sin nombre";
    const email = record.email?.trim() ?? "";

    try {
      if (record.existingId) {
        await db.update(clientsTable)
          .set({ name, email, phone: record.phone ?? null, company: record.company ?? null, notes: record.notes ?? null, tags: record.tags ?? null, value: record.value ?? null })
          .where(and(eq(clientsTable.id, record.existingId), eq(clientsTable.orgId, orgId)));
        results.push({ success: true, id: record.existingId, name, action: "updated" }); updated++;
      } else {
        const [newClient] = await db.insert(clientsTable)
          .values({ orgId, name, email, phone: record.phone ?? null, company: record.company ?? null, status: (record.status as "lead" | "client" | "prospect") ?? "lead", notes: record.notes ?? null, tags: record.tags ?? null, value: record.value ?? null })
          .returning({ id: clientsTable.id });

        if (newClient) {
          db.insert(activityTable).values({ orgId, type: "client_added", description: `[Omni Import AI] ${name}${record.company ? ` (${record.company})` : ""}`, clientId: newClient.id, createdBy: clerkUserId ?? "import-ai" }).catch(() => {});
        }
        results.push({ success: true, id: newClient?.id, name, action: "created" }); created++;
      }
    } catch (err) {
      results.push({ success: false, name, error: String(err), action: "error" });
    }
  }

  // Update the latest import job with records_created count
  db.execute(sql`UPDATE import_jobs SET records_created=${created + updated} WHERE org_id=${orgId} ORDER BY created_at DESC LIMIT 1`).catch(() => {});

  res.json({ results, summary: { created, updated, skipped, total: results.length } });
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
      SELECT COUNT(*)::int AS total_imports, COALESCE(SUM(records_created),0)::int AS total_records, COALESCE(SUM(CASE WHEN errors IS NOT NULL THEN 1 ELSE 0 END),0)::int AS total_errors
      FROM import_jobs WHERE org_id=${orgId}
    `),
    db.execute(sql`
      SELECT detected_type, COUNT(*)::int AS cnt FROM import_jobs WHERE org_id=${orgId} GROUP BY detected_type ORDER BY cnt DESC
    `),
  ]);

  const tot = ((totals as { rows: Array<Record<string, number>> }).rows[0]) ?? {};
  const timeSavedMin = (Number(tot.total_records ?? 0) * 3);

  res.json({
    totalImports:  Number(tot.total_imports ?? 0),
    totalRecords:  Number(tot.total_records ?? 0),
    totalErrors:   Number(tot.total_errors  ?? 0),
    timeSavedMin,
    byType: (byType as { rows: Array<{ detected_type: string; cnt: number }> }).rows,
  });
});
