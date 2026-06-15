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
  limits: { fileSize: 20 * 1024 * 1024 },
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

  // ── [7/8] OPENAI CALL ────────────────────────────────────────────────────
  if (content.type === "text") {
    console.log("[ImportAI][7/8] OPENAI CALL — text mode", {
      model:            "gpt-4o",
      contentType:      "text",
      fullTextLength:   content.text.length,
      textSlicedTo:     Math.min(content.text.length, 8000),
      textPreview:      content.text.slice(0, 400),
      textTail:         content.text.length > 400 ? content.text.slice(-200) : "(same as preview)",
    });
  } else {
    console.log("[ImportAI][7/8] OPENAI CALL — image/vision mode", {
      model:       "gpt-4o",
      contentType: "image",
      mime:        content.mime,
      b64Length:   content.b64.length,
    });
  }

  const userContent: OpenAI.Chat.ChatCompletionMessageParam["content"] =
    content.type === "image"
      ? [
          { type: "image_url" as const, image_url: { url: `data:${content.mime};base64,${content.b64}`, detail: "high" as const } },
          { type: "text" as const, text: "Extrae toda la información de esta imagen/documento. Devuelve SOLO el JSON." },
        ]
      : `Extrae toda la información del siguiente contenido:\n\n${content.text.slice(0, 8000)}`;

  let completion: OpenAI.Chat.ChatCompletion;
  try {
    completion = await openai.chat.completions.create({
      model:           "gpt-4o",
      messages:        [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userContent },
      ],
      temperature:     0.1,
      max_tokens:      2000,
      response_format: { type: "json_object" },
    });
  } catch (openAiErr) {
    console.error("[ImportAI][7-ERR] OPENAI API CALL FAILED", {
      message: (openAiErr as Error).message,
      stack:   (openAiErr as Error).stack,
    });
    throw openAiErr;
  }

  // ── [8/8] OPENAI RESPONSE ────────────────────────────────────────────────
  const rawContent    = completion.choices[0]?.message?.content ?? null;
  const finishReason  = completion.choices[0]?.finish_reason ?? null;
  const tokensIn      = completion.usage?.prompt_tokens    ?? 0;
  const tokensOut     = completion.usage?.completion_tokens ?? 0;

  console.log("[ImportAI][8/8] OPENAI RESPONSE", {
    finishReason,
    tokensIn,
    tokensOut,
    rawContentLength: rawContent?.length ?? 0,
    rawContentPreview: rawContent?.slice(0, 800) ?? "(null)",
    rawContentTail:    rawContent && rawContent.length > 800 ? rawContent.slice(-200) : "(same as preview)",
  });

  // ── JSON parse attempt ───────────────────────────────────────────────────
  try {
    const parsed = JSON.parse(rawContent ?? "{}") as Record<string, unknown>;
    console.log("[ImportAI][8b] JSON PARSE SUCCESS", {
      detected_type: parsed.detected_type,
      confidence:    parsed.confidence,
      recordCount:   Array.isArray(parsed.records) ? parsed.records.length : "NOT_ARRAY",
      records:       parsed.records,
    });
    logAiCall({
      orgId, userClerkId: clerkUserId,
      functionName: "import_ai_analysis",
      model:        "gpt-4o",
      tokensInput:  tokensIn,
      tokensOutput: tokensOut,
      durationMs:   Date.now() - t0,
    }).catch(() => {});
    return parsed;
  } catch (jsonErr) {
    console.error("[ImportAI][8-ERR] JSON PARSE FAILED", {
      message:      (jsonErr as Error).message,
      rawContent,
    });
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

  // ── [1/8] FILE RECEIVED ──────────────────────────────────────────────────
  console.log("[ImportAI][1/8] FILE RECEIVED", {
    originalname: file.originalname,
    mimetypeFromMulter: file.mimetype,
    sizeBytes:    file.size,
    bufferLength: file.buffer.length,
    orgId,
    clerkUserId,
  });

  // ── [2/8] MIME / EXT DETECTION ──────────────────────────────────────────
  const branch = IMAGE_EXTS.has(ext) ? "IMAGE"
    : DOCUMENT_EXTS.has(ext)         ? "PDF"
    : SPREADSHEET_EXTS.has(ext)      ? "XLSX"
    : CSV_EXTS.has(ext)              ? "CSV"
    : "PLAIN_TEXT";

  console.log("[ImportAI][2/8] MIME DETECTION", {
    ext,
    branch,
    isImage: IMAGE_EXTS.has(ext),
    isPDF:   DOCUMENT_EXTS.has(ext),
    isXLSX:  SPREADSHEET_EXTS.has(ext),
    isCSV:   CSV_EXTS.has(ext),
  });

  // ── [3/8] BUFFER READ ────────────────────────────────────────────────────
  const magicHex = file.buffer.slice(0, 8).toString("hex").toUpperCase();
  const magicAscii = file.buffer.slice(0, 8).toString("ascii").replace(/[^\x20-\x7E]/g, ".");
  console.log("[ImportAI][3/8] BUFFER READ", {
    bufferLength: file.buffer.length,
    magicBytesHex:   magicHex,
    magicBytesAscii: magicAscii,
    isPdfMagic:      magicHex.startsWith("255044462D"),   // %PDF-
    isXlsxMagic:     magicHex.startsWith("504B0304"),     // PK.. (ZIP)
  });

  try {
    let result: Record<string, unknown>;

    if (IMAGE_EXTS.has(ext)) {
      console.log("[ImportAI][3b] PATH → Image/Vision");
      result = await analyzeWithAI(openai,
        { type: "image", b64: file.buffer.toString("base64"), mime: mimeForExt(ext) },
        orgId, clerkUserId);

    } else if (DOCUMENT_EXTS.has(ext)) {
      console.log("[ImportAI][3b] PATH → PDF");

      // ── [4/8] PARSE PDF ────────────────────────────────────────────────
      const pdfMod = await import("pdf-parse");
      console.log("[ImportAI][4/8] PDF MODULE SHAPE", {
        moduleType:      typeof pdfMod,
        moduleKeys:      Object.keys(pdfMod as object),
        defaultType:     typeof (pdfMod as Record<string, unknown>).default,
        defaultIsFunction: typeof (pdfMod as Record<string, unknown>).default === "function",
        rootIsFunction:    typeof pdfMod === "function",
      });

      const pdfParse = (pdfMod.default ?? pdfMod) as (buf: Buffer) => Promise<{ text: string; numpages: number; info: Record<string, unknown> }>;
      console.log("[ImportAI][4b] PDF PARSE FN", {
        resolvedFnType: typeof pdfParse,
        isFunction:     typeof pdfParse === "function",
      });

      let parsed: { text: string; numpages: number; info: Record<string, unknown> };
      try {
        parsed  = await pdfParse(file.buffer);
        rawText = parsed.text;
        console.log("[ImportAI][4c] PDF PARSED OK", {
          numpages:       parsed.numpages,
          textLength:     rawText.length,
          textIsEmpty:    rawText.trim().length === 0,
          textPreview:    rawText.slice(0, 400),
          info:           parsed.info,
        });
      } catch (pdfErr) {
        console.error("[ImportAI][4-ERR] PDF PARSE FAILED", {
          message: (pdfErr as Error).message,
          stack:   (pdfErr as Error).stack,
        });
        throw pdfErr;
      }

      // ── [6/8] TEXT CONVERSION ──────────────────────────────────────────
      console.log("[ImportAI][6/8] TEXT TO AI (PDF)", {
        rawTextLength: rawText.length,
        slicedTo:      Math.min(rawText.length, 8000),
        preview:       rawText.slice(0, 400),
      });

      result = await analyzeWithAI(openai, { type: "text", text: rawText }, orgId, clerkUserId);

    } else if (SPREADSHEET_EXTS.has(ext)) {
      console.log("[ImportAI][3b] PATH → XLSX/XLS");

      // ── [5/8] PARSE XLSX ───────────────────────────────────────────────
      let XLSX: typeof import("xlsx");
      try {
        XLSX = await import("xlsx");
        console.log("[ImportAI][5/8] XLSX MODULE SHAPE", {
          moduleType:  typeof XLSX,
          hasRead:     typeof XLSX.read === "function",
          hasUtils:    typeof XLSX.utils === "object",
        });
      } catch (xlsxImportErr) {
        console.error("[ImportAI][5-ERR] XLSX IMPORT FAILED", {
          message: (xlsxImportErr as Error).message,
          stack:   (xlsxImportErr as Error).stack,
        });
        throw xlsxImportErr;
      }

      let wb: ReturnType<typeof XLSX.read>;
      try {
        wb = XLSX.read(file.buffer, { type: "buffer" });
        console.log("[ImportAI][5b] WORKBOOK PARSED", {
          sheetNames:  wb.SheetNames,
          sheetCount:  wb.SheetNames.length,
        });
      } catch (wbErr) {
        console.error("[ImportAI][5-ERR] WORKBOOK READ FAILED", {
          message: (wbErr as Error).message,
          stack:   (wbErr as Error).stack,
        });
        throw wbErr;
      }

      const ws   = wb.Sheets[wb.SheetNames[0]!];
      const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws!, { defval: "" });
      rawText    = JSON.stringify(rows.slice(0, 200), null, 2);

      console.log("[ImportAI][5c] ROWS EXTRACTED", {
        totalRows:   rows.length,
        rowsSentToAI: Math.min(rows.length, 200),
        firstRow:    rows[0] ?? null,
        columnKeys:  rows[0] ? Object.keys(rows[0]) : [],
      });

      // ── [6/8] TEXT CONVERSION ──────────────────────────────────────────
      const textForAI = `Excel/Hoja de cálculo con ${rows.length} filas:\n${rawText}`;
      console.log("[ImportAI][6/8] TEXT TO AI (XLSX)", {
        rawTextLength: rawText.length,
        fullPromptLength: textForAI.length,
        slicedTo: Math.min(textForAI.length, 8000),
      });

      result = await analyzeWithAI(openai, { type: "text", text: textForAI }, orgId, clerkUserId);

    } else if (CSV_EXTS.has(ext)) {
      console.log("[ImportAI][3b] PATH → CSV");
      rawText = file.buffer.toString("utf-8");
      console.log("[ImportAI][6/8] TEXT TO AI (CSV)", { rawTextLength: rawText.length, preview: rawText.slice(0, 300) });
      result = await analyzeWithAI(openai, { type: "text", text: `CSV:\n${rawText}` }, orgId, clerkUserId);

    } else {
      console.log("[ImportAI][3b] PATH → PLAIN TEXT / OTHER");
      rawText = file.buffer.toString("utf-8");
      console.log("[ImportAI][6/8] TEXT TO AI (PLAIN)", { rawTextLength: rawText.length, preview: rawText.slice(0, 300) });
      result = await analyzeWithAI(openai, { type: "text", text: rawText }, orgId, clerkUserId);
    }

    const detectedType  = String(result.detected_type ?? "other");
    const confidence    = Number(result.confidence   ?? 0);
    const suggestedDest = String(result.suggested_destination ?? "CRM");

    console.log("[ImportAI][DONE] FINAL RESULT", {
      detectedType, confidence, suggestedDest,
      recordCount: Array.isArray(result.records) ? (result.records as unknown[]).length : "NOT_ARRAY",
    });

    await db.execute(sql`
      INSERT INTO import_jobs (org_id, user_clerk_id, file_name, file_type, detected_type, confidence_pct, raw_text, extracted_data, suggested_dest)
      VALUES (${orgId}, ${clerkUserId}, ${file.originalname}, ${ext}, ${detectedType}, ${confidence}, ${rawText.slice(0, 2000) || null}, ${JSON.stringify(result)}::jsonb, ${suggestedDest})
    `);

    res.json({ ...result, fileName: file.originalname, fileType: ext });
  } catch (err) {
    console.error("[ImportAI][CATCH] UPLOAD FAILED", {
      message: err instanceof Error ? err.message : String(err),
      stack:   err instanceof Error ? err.stack : undefined,
    });
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
