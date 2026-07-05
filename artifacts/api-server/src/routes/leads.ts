import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import OpenAI from "openai";
import type { Request } from "express";

export const leadsRouter = Router();

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const GOOGLE_KEY = process.env.GOOGLE_PLACES_API_KEY ?? "";

function dbRows<T>(r: unknown): T[] {
  return (r as { rows: T[] }).rows;
}

// ── Google Places helpers ─────────────────────────────────────────────────────
async function fetchPlaceDetails(placeId: string): Promise<{ phone: string; website: string }> {
  if (!GOOGLE_KEY) return { phone: "", website: "" };
  try {
    const url = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${placeId}&fields=formatted_phone_number,website&key=${GOOGLE_KEY}&language=es`;
    const resp = await fetch(url);
    const data = await resp.json() as { result?: { formatted_phone_number?: string; website?: string } };
    return {
      phone:   data.result?.formatted_phone_number ?? "",
      website: data.result?.website ?? "",
    };
  } catch {
    return { phone: "", website: "" };
  }
}

async function searchGooglePlaces(sector: string, city: string, maxResults: number) {
  if (!GOOGLE_KEY) {
    throw new Error("GOOGLE_PLACES_API_KEY no está configurada. Añádela en los secretos del servidor para activar la búsqueda.");
  }

  const results: Array<{
    placeId: string; name: string; address: string; phone: string; website: string;
    rating: number | null; reviewCount: number | null; lat: number | null; lng: number | null;
  }> = [];

  const query  = encodeURIComponent(`${sector} en ${city}`);
  let   nextUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?query=${query}&language=es&key=${GOOGLE_KEY}`;
  let   page    = 0;
  const maxPages = Math.ceil(maxResults / 20);

  while (results.length < maxResults && page < maxPages) {
    const resp = await fetch(nextUrl);
    const data = await resp.json() as {
      status: string; error_message?: string;
      results: Array<{
        place_id: string; name: string; formatted_address: string;
        rating?: number; user_ratings_total?: number;
        geometry?: { location: { lat: number; lng: number } };
      }>;
      next_page_token?: string;
    };

    if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
      throw new Error(`Google Places: ${data.status}${data.error_message ? " — " + data.error_message : ""}`);
    }

    for (const place of data.results) {
      if (results.length >= maxResults) break;
      const details = await fetchPlaceDetails(place.place_id);
      results.push({
        placeId:     place.place_id,
        name:        place.name,
        address:     place.formatted_address ?? "",
        phone:       details.phone,
        website:     details.website,
        rating:      place.rating ?? null,
        reviewCount: place.user_ratings_total ?? null,
        lat:         place.geometry?.location.lat ?? null,
        lng:         place.geometry?.location.lng ?? null,
      });
    }

    if (!data.next_page_token || results.length >= maxResults) break;
    await new Promise(r => setTimeout(r, 2100));
    nextUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json?pagetoken=${data.next_page_token}&key=${GOOGLE_KEY}`;
    page++;
  }

  return results;
}

// ── Website analysis ──────────────────────────────────────────────────────────
async function analyzeWebsite(website: string | null, name: string, sector: string) {
  const checks = {
    hasWebsite: !!website, hasHttps: false, hasForm: false, hasWhatsapp: false,
    hasFacebook: false, hasInstagram: false, hasGoogleBusiness: false, hasCta: false,
    hasMobileOptimization: false, hasLoadSpeed: false, hasContactInfo: false,
  };

  let htmlSnippet = "";

  if (website) {
    checks.hasHttps = website.startsWith("https://");
    try {
      const ctrl    = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), 8000);
      const t0      = Date.now();
      const resp    = await fetch(website, {
        signal:  ctrl.signal,
        headers: { "User-Agent": "Mozilla/5.0 (compatible; OmniLeadsBot/1.0; +https://omnitech.ai)" },
      });
      clearTimeout(timeout);
      const elapsed = Date.now() - t0;
      const html    = await resp.text();
      const lo      = html.toLowerCase();

      checks.hasForm            = /<form[\s>]/i.test(html);
      checks.hasWhatsapp        = lo.includes("wa.me") || lo.includes("whatsapp.com");
      checks.hasFacebook        = lo.includes("facebook.com") || lo.includes("fb.com");
      checks.hasInstagram       = lo.includes("instagram.com");
      checks.hasGoogleBusiness  = lo.includes("business.google.com") || lo.includes("g.page");
      checks.hasCta             = /<button[^>]*>/i.test(html) || lo.includes("contact") || lo.includes("contacto");
      checks.hasMobileOptimization = lo.includes('name="viewport"') || lo.includes("name='viewport'");
      checks.hasLoadSpeed       = elapsed < 3000;
      checks.hasContactInfo     = /tel:|mailto:|(\+\d{7,})/i.test(html);
      htmlSnippet               = html.slice(0, 3000);
    } catch {
      // unreachable or timeout
    }
  }

  const positiveCount = Object.values(checks).filter(Boolean).length;
  const prompt = `Eres un experto en marketing digital B2B. Analiza esta empresa y genera un análisis de oportunidad comercial.

Empresa: ${name}
Sector: ${sector}
Web: ${website ?? "No tiene"}
Señales detectadas: Web=${checks.hasWebsite}, HTTPS=${checks.hasHttps}, Formulario=${checks.hasForm}, WhatsApp=${checks.hasWhatsapp}, Facebook=${checks.hasFacebook}, Instagram=${checks.hasInstagram}, GoogleBusiness=${checks.hasGoogleBusiness}, CTA=${checks.hasCta}, Móvil=${checks.hasMobileOptimization}, Velocidad=${checks.hasLoadSpeed}, Contacto=${checks.hasContactInfo}
${htmlSnippet ? `Contenido web: ${htmlSnippet}` : ""}

Responde ÚNICAMENTE con este JSON (sin markdown):
{"score":<0-100>,"opportunity":"<alta|media|baja>","summary":"<2-3 frases>","improvements":["<mejora1>","<mejora2>","<mejora3>"]}

Score alto (65-100) = pocas señales digitales = ALTA oportunidad de venta de servicios digitales.
Score bajo (0-35) = muchas señales = BAJA oportunidad.`;

  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 500,
      temperature: 0.3,
    });
    const raw    = completion.choices[0]?.message?.content ?? "{}";
    const parsed = JSON.parse(raw) as { score: number; opportunity: string; summary: string; improvements: string[] };
    return {
      ...checks,
      score:       Math.max(0, Math.min(100, Number(parsed.score) || 50)),
      opportunity: ["alta", "media", "baja"].includes(parsed.opportunity) ? parsed.opportunity : "media",
      summary:     parsed.summary ?? "",
      improvements: JSON.stringify(Array.isArray(parsed.improvements) ? parsed.improvements : []),
    };
  } catch {
    const score = Math.max(0, 100 - positiveCount * 9);
    return {
      ...checks,
      score,
      opportunity: score >= 65 ? "alta" : score >= 35 ? "media" : "baja",
      summary:     `${name} — análisis automático. ${positiveCount}/11 señales digitales detectadas.`,
      improvements: JSON.stringify([]),
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

// GET /dashboard
leadsRouter.get("/dashboard", async (req: Request, res) => {
  const orgId = req.orgId!;
  try {
    const stats = await db.execute(sql`
      SELECT
        (SELECT COUNT(*) FROM lead_searches WHERE org_id = ${orgId})::int                                        AS total_searches,
        (SELECT COUNT(*) FROM lead_results  WHERE org_id = ${orgId})::int                                        AS total_results,
        (SELECT COUNT(*) FROM lead_results  WHERE org_id = ${orgId} AND status = 'analyzed')::int                AS analyzed,
        (SELECT COUNT(*) FROM lead_results  WHERE org_id = ${orgId} AND status = 'added_to_crm')::int            AS leads_created,
        (SELECT COUNT(*) FROM lead_analysis WHERE org_id = ${orgId} AND opportunity = 'alta')::int               AS high_opp,
        (SELECT COUNT(*) FROM lead_analysis WHERE org_id = ${orgId} AND opportunity = 'media')::int              AS mid_opp,
        (SELECT COUNT(*) FROM lead_analysis WHERE org_id = ${orgId} AND opportunity = 'baja')::int               AS low_opp,
        (SELECT MAX(created_at) FROM lead_searches WHERE org_id = ${orgId})                                      AS last_search
    `);

    const recent = await db.execute(sql`
      SELECT id, sector, city, status, total_found, created_at
      FROM lead_searches WHERE org_id = ${orgId}
      ORDER BY created_at DESC LIMIT 6
    `);

    const distrib = await db.execute(sql`
      SELECT
        CASE WHEN score >= 65 THEN 'Alta' WHEN score >= 35 THEN 'Media' ELSE 'Baja' END AS level,
        COUNT(*)::int AS cnt
      FROM lead_analysis WHERE org_id = ${orgId}
      GROUP BY 1
    `);

    const row = dbRows<Record<string, unknown>>(stats)[0] ?? {};
    res.json({
      totalSearches:    Number(row.total_searches ?? 0),
      totalResults:     Number(row.total_results  ?? 0),
      analyzed:         Number(row.analyzed       ?? 0),
      leadsCreated:     Number(row.leads_created  ?? 0),
      highOpportunity:  Number(row.high_opp       ?? 0),
      mediumOpportunity: Number(row.mid_opp       ?? 0),
      lowOpportunity:   Number(row.low_opp        ?? 0),
      lastSearch:       row.last_search ?? null,
      recentSearches:   dbRows<Record<string, unknown>>(recent),
      scoreDistrib:     dbRows<Record<string, unknown>>(distrib),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /search
leadsRouter.post("/search", async (req: Request, res) => {
  const orgId  = req.orgId!;
  const userId = req.userId!;
  const { sector, city, postalCode, radiusKm = 20, maxResults = 20 } = req.body as {
    sector: string; city: string; postalCode?: string; radiusKm?: number; maxResults?: number;
  };

  if (!sector?.trim() || !city?.trim()) {
    res.status(400).json({ error: "sector y city son requeridos" });
    return;
  }

  const safeMax = Math.min(60, Math.max(1, Number(maxResults) || 20));

  const ins = await db.execute(sql`
    INSERT INTO lead_searches (org_id, created_by, sector, city, postal_code, radius_km, max_results, status)
    VALUES (${orgId}, ${userId}, ${sector.trim()}, ${city.trim()}, ${postalCode ?? null}, ${Number(radiusKm)}, ${safeMax}, 'running')
    RETURNING id
  `);
  const searchId = dbRows<{ id: number }>(ins)[0]?.id;

  try {
    const places = await searchGooglePlaces(sector.trim(), city.trim(), safeMax);

    let inserted = 0;
    for (const p of places) {
      await db.execute(sql`
        INSERT INTO lead_results
          (org_id, search_id, created_by, place_id, name, address, phone, website, rating, review_count, lat, lng, sector, status)
        VALUES
          (${orgId}, ${searchId}, ${userId}, ${p.placeId}, ${p.name}, ${p.address},
           ${p.phone || null}, ${p.website || null}, ${p.rating ?? null}, ${p.reviewCount ?? null},
           ${p.lat ?? null}, ${p.lng ?? null}, ${sector.trim()}, 'new')
        ON CONFLICT DO NOTHING
      `);
      inserted++;
    }

    await db.execute(sql`
      UPDATE lead_searches SET status = 'done', total_found = ${inserted}, updated_at = NOW()
      WHERE id = ${searchId}
    `);

    res.json({ searchId, found: inserted, status: "done" });
  } catch (err) {
    await db.execute(sql`
      UPDATE lead_searches SET status = 'failed', error_msg = ${String(err)}, updated_at = NOW()
      WHERE id = ${searchId}
    `);
    res.status(500).json({ error: String(err) });
  }
});

// GET /searches
leadsRouter.get("/searches", async (req: Request, res) => {
  const orgId = req.orgId!;
  try {
    const rows = await db.execute(sql`
      SELECT id, sector, city, radius_km, max_results, status, total_found, error_msg, created_at
      FROM lead_searches WHERE org_id = ${orgId}
      ORDER BY created_at DESC LIMIT 50
    `);
    res.json(dbRows<Record<string, unknown>>(rows));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /results
leadsRouter.get("/results", async (req: Request, res) => {
  const orgId    = req.orgId!;
  const { searchId, status, opportunity, q, page = "1", limit = "20" } = req.query as Record<string, string>;
  const pageNum  = Math.max(1, Number(page));
  const pageSize = Math.min(100, Math.max(1, Number(limit) || 20));
  const offset   = (pageNum - 1) * pageSize;

  const searchFilter = searchId   ? sql`AND r.search_id = ${Number(searchId)}` : sql``;
  const statusFilter = status     ? sql`AND r.status = ${status}` : sql``;
  const oppFilter    = opportunity? sql`AND a.opportunity = ${opportunity}` : sql``;
  const qFilter      = q          ? sql`AND (r.name ILIKE ${"%" + q + "%"} OR r.address ILIKE ${"%" + q + "%"})` : sql``;

  try {
    const rows = await db.execute(sql`
      SELECT
        r.id, r.name, r.address, r.phone, r.website, r.email,
        r.rating, r.review_count, r.sector, r.status, r.crm_client_id, r.created_at,
        a.score, a.opportunity, a.summary,
        a.has_website, a.has_https, a.has_form, a.has_whatsapp, a.has_facebook,
        a.has_instagram, a.has_google_business, a.has_cta,
        a.has_mobile_optimization, a.has_load_speed, a.has_contact_info, a.improvements
      FROM lead_results r
      LEFT JOIN lead_analysis a ON a.result_id = r.id AND a.org_id = r.org_id
      WHERE r.org_id = ${orgId}
        ${searchFilter} ${statusFilter} ${oppFilter} ${qFilter}
      ORDER BY r.created_at DESC
      LIMIT ${pageSize} OFFSET ${offset}
    `);

    const countRows = await db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM lead_results r
      LEFT JOIN lead_analysis a ON a.result_id = r.id AND a.org_id = r.org_id
      WHERE r.org_id = ${orgId}
        ${searchFilter} ${statusFilter} ${oppFilter} ${qFilter}
    `);

    const total = Number(dbRows<{ total: number }>(countRows)[0]?.total ?? 0);
    res.json({
      data:  dbRows<Record<string, unknown>>(rows),
      total,
      page:  pageNum,
      pages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /results/bulk-analyze  (must be before /:id routes)
leadsRouter.post("/results/bulk-analyze", async (req: Request, res) => {
  const orgId  = req.orgId!;
  const userId = req.userId!;
  const { ids } = req.body as { ids: number[] };

  if (!Array.isArray(ids) || ids.length === 0) {
    res.status(400).json({ error: "ids es requerido" }); return;
  }
  if (ids.length > 10) {
    res.status(400).json({ error: "Máximo 10 empresas a la vez" }); return;
  }

  res.json({ message: `Análisis iniciado para ${ids.length} empresa(s)`, ids });

  void (async () => {
    for (const id of ids) {
      try {
        const rows = await db.execute(sql`
          SELECT id, name, website, sector FROM lead_results
          WHERE id = ${id} AND org_id = ${orgId}
        `);
        const row = dbRows<{ id: number; name: string; website: string | null; sector: string | null }>(rows)[0];
        if (!row) continue;

        await db.execute(sql`UPDATE lead_results SET status='analyzing', updated_at=NOW() WHERE id=${id} AND org_id=${orgId}`);
        const analysis = await analyzeWebsite(row.website, row.name, row.sector ?? "");
        await db.execute(sql`DELETE FROM lead_analysis WHERE result_id=${id} AND org_id=${orgId}`);
        await db.execute(sql`
          INSERT INTO lead_analysis
            (org_id, result_id, created_by, has_website, has_https, has_form, has_whatsapp,
             has_facebook, has_instagram, has_google_business, has_cta,
             has_mobile_optimization, has_load_speed, has_contact_info,
             score, opportunity, summary, improvements)
          VALUES
            (${orgId}, ${id}, ${userId},
             ${analysis.hasWebsite}, ${analysis.hasHttps}, ${analysis.hasForm}, ${analysis.hasWhatsapp},
             ${analysis.hasFacebook}, ${analysis.hasInstagram}, ${analysis.hasGoogleBusiness}, ${analysis.hasCta},
             ${analysis.hasMobileOptimization}, ${analysis.hasLoadSpeed}, ${analysis.hasContactInfo},
             ${analysis.score}, ${analysis.opportunity}, ${analysis.summary}, ${analysis.improvements})
        `);
        await db.execute(sql`UPDATE lead_results SET status='analyzed', updated_at=NOW() WHERE id=${id} AND org_id=${orgId}`);
      } catch { /* continue */ }
    }
  })();
});

// POST /results/:id/analyze
leadsRouter.post("/results/:id/analyze", async (req: Request, res) => {
  const orgId    = req.orgId!;
  const userId   = req.userId!;
  const resultId = Number(req.params.id);

  try {
    const rows = await db.execute(sql`
      SELECT id, name, website, sector FROM lead_results WHERE id=${resultId} AND org_id=${orgId}
    `);
    const row = dbRows<{ id: number; name: string; website: string | null; sector: string | null }>(rows)[0];
    if (!row) { res.status(404).json({ error: "No encontrado" }); return; }

    await db.execute(sql`UPDATE lead_results SET status='analyzing', updated_at=NOW() WHERE id=${resultId} AND org_id=${orgId}`);
    const analysis = await analyzeWebsite(row.website, row.name, row.sector ?? "");
    await db.execute(sql`DELETE FROM lead_analysis WHERE result_id=${resultId} AND org_id=${orgId}`);
    await db.execute(sql`
      INSERT INTO lead_analysis
        (org_id, result_id, created_by, has_website, has_https, has_form, has_whatsapp,
         has_facebook, has_instagram, has_google_business, has_cta,
         has_mobile_optimization, has_load_speed, has_contact_info,
         score, opportunity, summary, improvements)
      VALUES
        (${orgId}, ${resultId}, ${userId},
         ${analysis.hasWebsite}, ${analysis.hasHttps}, ${analysis.hasForm}, ${analysis.hasWhatsapp},
         ${analysis.hasFacebook}, ${analysis.hasInstagram}, ${analysis.hasGoogleBusiness}, ${analysis.hasCta},
         ${analysis.hasMobileOptimization}, ${analysis.hasLoadSpeed}, ${analysis.hasContactInfo},
         ${analysis.score}, ${analysis.opportunity}, ${analysis.summary}, ${analysis.improvements})
    `);
    await db.execute(sql`UPDATE lead_results SET status='analyzed', updated_at=NOW() WHERE id=${resultId} AND org_id=${orgId}`);

    res.json({ ...analysis, resultId });
  } catch (err) {
    await db.execute(sql`UPDATE lead_results SET status='new', updated_at=NOW() WHERE id=${resultId} AND org_id=${orgId}`).catch(() => {});
    res.status(500).json({ error: String(err) });
  }
});

// POST /results/:id/to-crm
leadsRouter.post("/results/:id/to-crm", async (req: Request, res) => {
  const orgId    = req.orgId!;
  const userId   = req.userId!;
  const resultId = Number(req.params.id);

  try {
    const rows = await db.execute(sql`
      SELECT r.*, a.score, a.opportunity, a.summary
      FROM lead_results r
      LEFT JOIN lead_analysis a ON a.result_id=r.id AND a.org_id=r.org_id
      WHERE r.id=${resultId} AND r.org_id=${orgId}
    `);
    const lead = dbRows<Record<string, unknown>>(rows)[0];
    if (!lead) { res.status(404).json({ error: "No encontrado" }); return; }
    if (lead.crm_client_id) { res.status(409).json({ error: "Ya está en el CRM" }); return; }

    const notes = [
      lead.address   ? `Dirección: ${lead.address}` : "",
      lead.website   ? `Web: ${lead.website}` : "",
      lead.summary   ? `Análisis IA: ${lead.summary}` : "",
      lead.score     != null ? `Puntuación IA: ${lead.score}/100` : "",
      lead.opportunity ? `Oportunidad: ${lead.opportunity}` : "",
      "Fuente: OmniLeads AI",
    ].filter(Boolean).join("\n");

    const ins = await db.execute(sql`
      INSERT INTO clients (org_id, name, phone, email, notes, status, created_at, updated_at)
      VALUES (
        ${orgId},
        ${String(lead.name)},
        ${lead.phone ? String(lead.phone) : null},
        ${lead.email ? String(lead.email) : null},
        ${notes},
        'lead',
        NOW(), NOW()
      )
      RETURNING id
    `);
    const clientId = dbRows<{ id: number }>(ins)[0]?.id;

    await db.execute(sql`
      UPDATE lead_results SET status='added_to_crm', crm_client_id=${clientId}, updated_at=NOW()
      WHERE id=${resultId} AND org_id=${orgId}
    `);

    res.json({ clientId, resultId });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// POST /results/:id/propose
leadsRouter.post("/results/:id/propose", async (req: Request, res) => {
  const orgId    = req.orgId!;
  const userId   = req.userId!;
  const resultId = Number(req.params.id);
  const { channel = "email", tone = "profesional" } = req.body as { channel?: string; tone?: string };

  try {
    const rows = await db.execute(sql`
      SELECT r.name, r.website, r.sector, r.address, r.phone,
             a.score, a.opportunity, a.summary, a.improvements,
             a.has_website, a.has_whatsapp, a.has_form, a.has_mobile_optimization
      FROM lead_results r
      LEFT JOIN lead_analysis a ON a.result_id=r.id AND a.org_id=r.org_id
      WHERE r.id=${resultId} AND r.org_id=${orgId}
    `);
    const lead = dbRows<Record<string, unknown>>(rows)[0];
    if (!lead) { res.status(404).json({ error: "No encontrado" }); return; }

    let improvements: string[] = [];
    try { improvements = JSON.parse(String(lead.improvements ?? "[]")); } catch { /* */ }

    const channelInstr: Record<string, string> = {
      email:    "Incluye un asunto al inicio (Asunto: ...). Máx 250 palabras. Tono profesional con CTA claro.",
      whatsapp: "Sé breve y directo. Máx 120 palabras. Usa 1-2 emojis naturales. Termina con una pregunta.",
      linkedin: "Tono profesional y cercano. Máx 200 palabras. Menciona algo específico de su empresa.",
    };

    const prompt = `Eres un experto en ventas B2B. Redacta un mensaje de prospección para esta empresa.

Empresa: ${lead.name}
Sector: ${lead.sector ?? ""}
Ciudad/Dirección: ${lead.address ?? ""}
Web: ${lead.website ?? "No tiene web"}
Puntuación digital: ${lead.score ?? "?"}/100
Oportunidad: ${lead.opportunity ?? ""}
Análisis: ${lead.summary ?? ""}
Carencias detectadas: ${improvements.join(", ") || "Presencia digital limitada"}
No tiene WhatsApp: ${lead.has_whatsapp ? "No" : "Sí, le falta"}
No tiene formulario: ${lead.has_form ? "No" : "Sí, le falta"}

Canal: ${channel} | Tono: ${tone}
${channelInstr[channel] ?? ""}

IMPORTANTE: Escribe como una persona real. Cita detalles específicos de la empresa. No uses frases genéricas. No menciones que usaste IA.

Escribe SOLO el mensaje.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 600,
      temperature: 0.75,
    });
    const content = completion.choices[0]?.message?.content ?? "";

    const ins = await db.execute(sql`
      INSERT INTO lead_messages (org_id, result_id, created_by, channel, content, tone, status)
      VALUES (${orgId}, ${resultId}, ${userId}, ${channel}, ${content}, ${tone}, 'draft')
      RETURNING id
    `);
    const messageId = dbRows<{ id: number }>(ins)[0]?.id;

    res.json({ messageId, content, channel, tone });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// GET /results/:id/messages
leadsRouter.get("/results/:id/messages", async (req: Request, res) => {
  const orgId    = req.orgId!;
  const resultId = Number(req.params.id);
  try {
    const rows = await db.execute(sql`
      SELECT id, channel, content, tone, status, sent_at, created_at
      FROM lead_messages WHERE result_id=${resultId} AND org_id=${orgId}
      ORDER BY created_at DESC
    `);
    res.json(dbRows<Record<string, unknown>>(rows));
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

// DELETE /results/:id
leadsRouter.delete("/results/:id", async (req: Request, res) => {
  const orgId    = req.orgId!;
  const resultId = Number(req.params.id);
  try {
    await db.execute(sql`DELETE FROM lead_results WHERE id=${resultId} AND org_id=${orgId}`);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});
