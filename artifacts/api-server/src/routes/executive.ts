import { Router } from "express";
import { logAiCall } from "../utils/aiUsageLogger";
import {
  db, clientsTable, appointmentsTable, quotesTable, activityTable, paymentsTable,
} from "@workspace/db";
import { eq, and, desc, gte, sum } from "drizzle-orm";
import { getProviderSingleton } from "../ai/types";
import { requirePermission } from "../middlewares/permissions";

export const executiveRouter = Router();

// ── Types ────────────────────────────────────────────────────────────────────
type Severity   = "critical" | "high" | "medium" | "low";
type Confidence = "muy alta" | "alta" | "media" | "baja";
type Urgency    = "urgente" | "alta" | "media" | "baja";

interface RiskItem {
  severity: Severity; type: string; title: string; description: string;
  client?: string; company?: string | null; value?: number | null;
  action: string; action_href: string;
}

interface PriorityItem {
  score: number; urgency: Urgency; title: string; description: string;
  client?: string; value?: number | null; action: string; action_href: string;
  due?: string;
}

interface OpportunityItem {
  type: string; title: string; description: string;
  client?: string; company?: string | null; estimated_value?: number | null;
  action: string; action_href: string; confidence: Confidence;
}

interface MonthlyPoint {
  label: string; actual: number | null; forecast: number | null; type: "actual" | "forecast";
}

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmtDate(d: Date) {
  return d.toLocaleDateString("es-ES", { day: "numeric", month: "short", year: "numeric" });
}
function fmtTime(d: Date) {
  return d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
function daysDiff(a: Date, b: Date) {
  return Math.round((a.getTime() - b.getTime()) / 86_400_000);
}

// FIX-AR: "Ingresos confirmados" must reflect real money collected (payments
// registered against invoices in Omni Accounting), not "quotes the client
// verbally accepted". A quote's status stays "accepted" forever even after
// it's converted to an invoice and that invoice remains unpaid — so summing
// accepted-quote totals silently counted uncollected money as "confirmed".
async function getRealConfirmedValue(orgId: number): Promise<number> {
  const [{ total }] = await db
    .select({ total: sum(paymentsTable.amount) })
    .from(paymentsTable)
    .where(eq(paymentsTable.orgId, orgId));
  return parseFloat(String(total ?? 0));
}

function buildMonthlyForecast(
  quotes: (typeof quotesTable.$inferSelect)[],
  now: Date,
): MonthlyPoint[] {
  const pipelineTotal = quotes
    .filter(q => ["draft", "sent"].includes(q.status))
    .reduce((s, q) => s + (q.total ?? 0), 0);

  const result: MonthlyPoint[] = [];
  for (let i = -2; i <= 3; i++) {
    const d    = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const label = d.toLocaleDateString("es-ES", { month: "short", year: "2-digit" });

    if (i <= 0) {
      const actual = quotes
        .filter(q => q.status === "accepted" && q.createdAt >= d && q.createdAt < next)
        .reduce((s, q) => s + (q.total ?? 0), 0);
      result.push({ label, actual: Math.round(actual), forecast: null, type: "actual" });
    } else {
      const factor = [0.28, 0.22, 0.15, 0.10][i - 1] ?? 0.10;
      result.push({ label, actual: null, forecast: Math.round(pipelineTotal * factor), type: "forecast" });
    }
  }
  return result;
}

// ── Main endpoint ─────────────────────────────────────────────────────────────
executiveRouter.get("/", requirePermission("analytics.read"), async (req, res) => {
  const orgId = (req as Request & { orgId?: number }).orgId;
  if (!orgId) { res.status(403).json({ error: "Sin organización" }); return; }
  const now   = new Date();
  const thirtyAgo      = new Date(now.getTime() - 30  * 86_400_000);
  const sevenFromNow   = new Date(now.getTime() + 7   * 86_400_000);

  const [allClients, allQuotes, allAppointments, recentActivity, confirmedValue] = await Promise.all([
    db.select().from(clientsTable).where(eq(clientsTable.orgId, orgId)),
    db.select().from(quotesTable).where(eq(quotesTable.orgId, orgId)),
    db.select().from(appointmentsTable).where(eq(appointmentsTable.orgId, orgId))
       .orderBy(desc(appointmentsTable.startTime)),
    db.select().from(activityTable)
       .where(and(eq(activityTable.orgId, orgId), gte(activityTable.createdAt, thirtyAgo)))
       .orderBy(desc(activityTable.createdAt)).limit(50),
    getRealConfirmedValue(orgId),
  ]);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const pipelineQuotes  = allQuotes.filter(q => ["draft", "sent", "pending"].includes(q.status));
  const acceptedQuotes  = allQuotes.filter(q => q.status === "accepted");
  const closedQuotes    = allQuotes.filter(q => ["accepted", "rejected"].includes(q.status));
  const sentQuotes      = allQuotes.filter(q => q.status === "sent");
  const pendingQuotes   = allQuotes.filter(q => q.status === "pending");
  const pipelineValue   = pipelineQuotes.reduce((s, q) => s + (q.total ?? 0), 0);
  // FIX-AR: confirmedValue now comes from getRealConfirmedValue() (real payments)
  // instead of `acceptedQuotes.reduce(...)` — kept acceptedQuotes for other uses below.
  const totalSent       = sentQuotes.reduce((s, q) => s + (q.total ?? 0), 0);
  const totalPendingVal = pendingQuotes.reduce((s, q) => s + (q.total ?? 0), 0);
  const activeClients   = allClients.filter(c => c.status === "active").length;
  const leadsCount      = allClients.filter(c => c.status === "lead").length;
  const atRiskCount     = allClients.filter(c => ["inactive","churned"].includes(c.status)).length;
  const conversionRate  = closedQuotes.length > 0
    ? Math.round((acceptedQuotes.length / closedQuotes.length) * 100)
    : null;

  const kpis = {
    pipeline_value:   Math.round(pipelineValue),
    confirmed_value:  Math.round(confirmedValue),
    active_clients:   activeClients,
    leads:            leadsCount,
    at_risk:          atRiskCount,
    total_clients:    allClients.length,
    conversion_rate:  conversionRate,
    total_quotes:     allQuotes.length,
    activity_30d:     recentActivity.length,
    total_sent:       Math.round(totalSent),
    total_accepted:   Math.round(confirmedValue),
    total_pending:    Math.round(totalPendingVal),
    closing_rate:     conversionRate,
  };

  // ── Revenue Forecast ──────────────────────────────────────────────────────
  const sentTotal  = allQuotes.filter(q => q.status === "sent").reduce((s, q) => s + (q.total ?? 0), 0);
  const draftTotal = allQuotes.filter(q => q.status === "draft").reduce((s, q) => s + (q.total ?? 0), 0);
  const forecast = {
    confirmed:             Math.round(confirmedValue),
    pipeline_conservative: Math.round(sentTotal * 0.35 + draftTotal * 0.10),
    pipeline_base:         Math.round(sentTotal * 0.55 + draftTotal * 0.20),
    pipeline_optimistic:   Math.round(sentTotal * 0.75 + draftTotal * 0.35),
    total_addressable:     Math.round(pipelineValue + confirmedValue),
    monthly:               buildMonthlyForecast(allQuotes, now),
  };

  // ── Risks ─────────────────────────────────────────────────────────────────
  const risks: RiskItem[] = [];

  allClients.filter(c => c.status === "churned").forEach(c => {
    risks.push({
      severity: "critical", type: "churn",
      title: `Cliente perdido: ${c.name}`,
      description: `${c.company ?? "Sin empresa"} canceló. Una propuesta de reactivación puede recuperarlo.`,
      client: c.name, company: c.company,
      action: "Preparar propuesta", action_href: "/quotes",
    });
  });

  allClients.filter(c => c.status === "inactive").forEach(c => {
    risks.push({
      severity: "high", type: "inactive",
      title: `Cliente inactivo: ${c.name}`,
      description: `${c.company ?? "Sin empresa"} lleva tiempo sin actividad. Riesgo de churn.`,
      client: c.name, company: c.company,
      action: "Programar seguimiento", action_href: "/calendar",
    });
  });

  allAppointments
    .filter(a => a.status === "pending" && a.startTime < now)
    .forEach(a => {
      const client = allClients.find(c => c.id === a.clientId);
      const daysOver = daysDiff(now, a.startTime);
      risks.push({
        severity: daysOver > 3 ? "high" : "medium", type: "overdue_appointment",
        title: `Cita vencida (${daysOver}d): ${a.title}`,
        description: `La reunión con ${client?.name ?? "cliente"} del ${fmtDate(a.startTime)} sigue en estado pendiente.`,
        client: client?.name, action: "Reprogramar", action_href: "/calendar",
      });
    });

  allQuotes
    .filter(q => q.validUntil && ["draft","sent"].includes(q.status) && q.validUntil <= sevenFromNow && q.validUntil >= now)
    .forEach(q => {
      const client = allClients.find(c => c.id === q.clientId);
      const daysLeft = Math.ceil(daysDiff(q.validUntil!, now));
      risks.push({
        severity: daysLeft <= 3 ? "critical" : "medium", type: "quote_expiring",
        title: `Presupuesto expira en ${daysLeft}d`,
        description: `"${q.title}" para ${client?.name ?? "cliente"} por €${q.total?.toLocaleString("es-ES")} vence el ${fmtDate(q.validUntil!)}.`,
        client: client?.name, value: q.total,
        action: "Renovar", action_href: "/quotes",
      });
    });

  const clientsWithAppts = new Set(allAppointments.map(a => a.clientId));
  allClients
    .filter(c => c.status === "lead" && !clientsWithAppts.has(c.id))
    .forEach(c => {
      const daysSince = daysDiff(now, new Date(c.createdAt));
      if (daysSince >= 3) {
        risks.push({
          severity: daysSince >= 14 ? "high" : "medium", type: "cold_lead",
          title: `Lead frío: ${c.name}`,
          description: `${c.company ?? "Sin empresa"} lleva ${daysSince}d sin contacto ni cita.`,
          client: c.name, company: c.company,
          action: "Primera reunión", action_href: "/calendar",
        });
      }
    });

  const severityOrder: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  risks.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  // ── Priorities ────────────────────────────────────────────────────────────
  const priorities: PriorityItem[] = [];

  allQuotes.filter(q => q.status === "sent").forEach(q => {
    const client    = allClients.find(c => c.id === q.clientId);
    const daysSent  = daysDiff(now, new Date(q.createdAt));
    priorities.push({
      score: 90 + daysSent * 2, urgency: daysSent >= 7 ? "urgente" : "alta",
      title: `Follow-up presupuesto #${q.quoteNumber ?? q.id}`,
      description: `Enviado hace ${daysSent}d a ${client?.name ?? "cliente"}. €${q.total?.toLocaleString("es-ES")} sin respuesta.`,
      client: client?.name, value: q.total,
      action: "Ver presupuesto", action_href: "/quotes",
    });
  });

  allAppointments
    .filter(a => a.status !== "cancelled" && a.startTime >= now && a.startTime <= sevenFromNow)
    .slice(0, 5)
    .forEach(a => {
      const client   = allClients.find(c => c.id === a.clientId);
      const daysLeft = Math.ceil(daysDiff(a.startTime, now));
      priorities.push({
        score: 85 - daysLeft * 8,
        urgency: daysLeft <= 1 ? "urgente" : "alta",
        title: `Cita próxima: ${a.title}`,
        description: `Con ${client?.name ?? "cliente"} el ${fmtDate(a.startTime)} a las ${fmtTime(a.startTime)}.`,
        client: client?.name,
        action: "Ver calendario", action_href: "/calendar",
        due: a.startTime.toISOString(),
      });
    });

  const completedClientIds = new Set(
    allAppointments.filter(a => a.status === "completed").map(a => a.clientId),
  );
  allClients.filter(c => c.status === "lead" && completedClientIds.has(c.id)).forEach(c => {
    priorities.push({
      score: 78, urgency: "alta",
      title: `Lead caliente listo para cerrar: ${c.name}`,
      description: `${c.company ?? "Sin empresa"} tiene reuniones completadas. Ideal para enviar presupuesto ahora.`,
      client: c.name,
      action: "Crear presupuesto", action_href: "/quotes",
    });
  });

  allClients.filter(c => c.status === "churned").forEach(c => {
    priorities.push({
      score: 65, urgency: "media",
      title: `Reactivar: ${c.name}`,
      description: `${c.company ?? "Sin empresa"} fue cliente. Una propuesta personalizada puede recuperarlo.`,
      client: c.name,
      action: "Preparar propuesta", action_href: "/quotes",
    });
  });

  priorities.sort((a, b) => b.score - a.score);

  // ── Opportunities ─────────────────────────────────────────────────────────
  const opportunities: OpportunityItem[] = [];
  const clientsWithQuotes = new Set(allQuotes.map(q => q.clientId));

  allClients.filter(c => c.status === "active" && !clientsWithQuotes.has(c.id)).forEach(c => {
    opportunities.push({
      type: "new_quote", confidence: "alta",
      title: `Primer presupuesto para ${c.name}`,
      description: `${c.company ?? "Sin empresa"} es cliente activo sin presupuesto formal. Alta probabilidad de éxito.`,
      client: c.name, company: c.company,
      action: "Crear presupuesto", action_href: "/quotes",
    });
  });

  allClients.filter(c => c.status === "lead" && completedClientIds.has(c.id)).forEach(c => {
    opportunities.push({
      type: "conversion", confidence: "muy alta",
      title: `Convertir lead: ${c.name}`,
      description: `Completó reuniones con ${c.company ?? "tu empresa"}. Probabilidad de cierre muy alta.`,
      client: c.name, company: c.company,
      action: "Enviar oferta", action_href: "/quotes",
    });
  });

  allClients
    .filter(c => c.status === "active" && allQuotes.some(q => q.clientId === c.id && q.status === "accepted"))
    .forEach(c => {
      opportunities.push({
        type: "upsell", confidence: "media",
        title: `Upsell: ${c.name}`,
        description: `Ya aceptó un presupuesto. Ideal para proponer servicios complementarios.`,
        client: c.name, company: c.company,
        action: "Ver cliente", action_href: "/clients",
      });
    });

  // ── Strategic insights (rule-based) ──────────────────────────────────────
  const insights: { icon: string; title: string; body: string }[] = [];

  if (atRiskCount > 0) {
    insights.push({
      icon: "⚠️",
      title: "Riesgo de ingresos recurrentes",
      body: `${atRiskCount} cliente${atRiskCount > 1 ? "s" : ""} inactivo${atRiskCount > 1 ? "s" : ""} o perdido${atRiskCount > 1 ? "s" : ""}. Si no se activan en los próximos 30 días, el impacto en pipeline puede ser significativo.`,
    });
  }

  if (pipelineValue > 0 && confirmedValue === 0) {
    insights.push({
      icon: "🎯",
      title: "Pipeline sin confirmaciones",
      body: `Hay €${pipelineValue.toLocaleString("es-ES")} en pipeline pero €0 confirmados. Prioriza el cierre de las oportunidades existentes antes de generar nuevas.`,
    });
  }

  if (leadsCount >= 3) {
    insights.push({
      icon: "🔥",
      title: `${leadsCount} leads activos`,
      body: `Con ${leadsCount} leads en proceso, el funnel está activo. Convierte los que tienen reuniones completadas antes de trabajar nuevos.`,
    });
  }

  if (allAppointments.filter(a => a.status === "completed").length === 0 && allAppointments.length > 0) {
    insights.push({
      icon: "📅",
      title: "Actividad comercial reducida",
      body: "No hay citas completadas registradas. Registra las reuniones realizadas para mantener el historial actualizado.",
    });
  }

  if (insights.length === 0) {
    insights.push({
      icon: "✅",
      title: "Pipeline saludable",
      body: "No se detectan riesgos críticos. Mantén la cadencia de seguimiento y genera nuevas oportunidades de upsell.",
    });
  }

  res.json({
    generated_at: now.toISOString(),
    kpis,
    forecast,
    risks:         risks.slice(0, 10),
    priorities:    priorities.slice(0, 8),
    opportunities: opportunities.slice(0, 8),
    insights,
  });
});

// ── POST /report — AI Executive Report ───────────────────────────────────────
executiveRouter.post("/report", requirePermission("analytics.read"), async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "OPENAI_API_KEY no configurada" }); return; }

  const orgId = (req as Request & { orgId?: number }).orgId ?? 1;
  const now = new Date();
  const thirtyAgo    = new Date(now.getTime() - 30 * 86_400_000);
  const sevenFromNow = new Date(now.getTime() + 7  * 86_400_000);

  const [allClients, allQuotes, allAppointments, recentActivity, confirmedValue] = await Promise.all([
    db.select().from(clientsTable).where(eq(clientsTable.orgId, orgId)),
    db.select().from(quotesTable).where(eq(quotesTable.orgId, orgId)),
    db.select().from(appointmentsTable).where(eq(appointmentsTable.orgId, orgId)).orderBy(desc(appointmentsTable.startTime)),
    db.select().from(activityTable).where(and(eq(activityTable.orgId, orgId), gte(activityTable.createdAt, thirtyAgo))).orderBy(desc(activityTable.createdAt)).limit(30),
    getRealConfirmedValue(orgId),
  ]);

  const pipelineQuotes  = allQuotes.filter(q => ["draft", "sent"].includes(q.status));
  const pipelineValue   = pipelineQuotes.reduce((s, q) => s + (q.total ?? 0), 0);
  // FIX-AR: confirmedValue now comes from getRealConfirmedValue() (real payments)
  const sentTotal       = allQuotes.filter(q => q.status === "sent").reduce((s, q) => s + (q.total ?? 0), 0);
  const draftTotal      = allQuotes.filter(q => q.status === "draft").reduce((s, q) => s + (q.total ?? 0), 0);
  const activeClients   = allClients.filter(c => c.status === "active");
  const inactiveClients = allClients.filter(c => ["inactive", "churned"].includes(c.status));
  const leads           = allClients.filter(c => c.status === "lead");
  const overdueAppts    = allAppointments.filter(a => a.status === "pending" && a.startTime < now);
  const expiringQuotes  = allQuotes.filter(q => q.validUntil && ["draft","sent"].includes(q.status) && q.validUntil <= sevenFromNow && q.validUntil >= now);

  const clientSummary = allClients.slice(0, 20).map(c => {
    const quotes   = allQuotes.filter(q => q.clientId === c.id);
    const appts    = allAppointments.filter(a => a.clientId === c.id);
    const totalVal = quotes.reduce((s, q) => s + (q.total ?? 0), 0);
    return `- ${c.name}${c.company ? " (" + c.company + ")" : ""}: estado=${c.status}, valor_total=€${totalVal}, presupuestos=${quotes.length}, citas=${appts.length}`;
  }).join("\n");

  const topQuotes = pipelineQuotes.slice(0, 8).map(q => {
    const c = allClients.find(cl => cl.id === q.clientId);
    return `- "${q.title}" para ${c?.name ?? "desconocido"}: €${q.total?.toLocaleString("es-ES")}, estado=${q.status}${q.validUntil ? ", vence=" + fmtDate(q.validUntil) : ""}`;
  }).join("\n");

  const context = [
    "DATOS DEL NEGOCIO (hoy: " + fmtDate(now) + "):",
    "",
    "CLIENTES:",
    `Total: ${allClients.length} | Activos: ${activeClients.length} | Leads: ${leads.length} | Inactivos/Perdidos: ${inactiveClients.length}`,
    clientSummary,
    "",
    "PIPELINE Y PRESUPUESTOS:",
    `Pipeline total: €${pipelineValue.toLocaleString("es-ES")} | Confirmado (cobrado real): €${confirmedValue.toLocaleString("es-ES")}`,
    `Escenario conservador 30d: €${Math.round(sentTotal * 0.35 + draftTotal * 0.10).toLocaleString("es-ES")}`,
    `Escenario base 30d: €${Math.round(sentTotal * 0.55 + draftTotal * 0.20).toLocaleString("es-ES")}`,
    `Escenario optimista 30d: €${Math.round(sentTotal * 0.75 + draftTotal * 0.35).toLocaleString("es-ES")}`,
    topQuotes || "Sin presupuestos activos",
    "",
    "RIESGOS:",
    overdueAppts.length > 0 ? `${overdueAppts.length} citas vencidas pendientes de reprogramar` : "Sin citas vencidas",
    expiringQuotes.length > 0 ? `${expiringQuotes.length} presupuestos expiran en los próximos 7 días` : "Sin presupuestos a vencer pronto",
    inactiveClients.length > 0 ? `Clientes en riesgo: ${inactiveClients.map(c => c.name).join(", ")}` : "Sin clientes en riesgo crítico",
    "",
    "ACTIVIDAD ÚLTIMOS 30 DÍAS:",
    `${recentActivity.length} registros de actividad`,
    "",
    "CALENDARIO:",
    `${allAppointments.filter(a => a.startTime >= now).length} citas futuras programadas`,
    `${allAppointments.filter(a => a.status === "completed").length} citas completadas en total`,
  ].join("\n");

  const aiProvider = getProviderSingleton();
  const result = await aiProvider.generate([
    {
      role: "system",
      content: `Eres el CFO/estratega de OmniTech. Genera un informe ejecutivo en español basado en datos reales de negocio.
Devuelve SOLO JSON con esta estructura exacta:
{
  "estado_general": {
    "score": <0-100 salud del negocio>,
    "titulo": "<resumen en máx 8 palabras>",
    "descripcion": "<2-3 frases concisas del estado actual>",
    "tendencia": "positiva|estable|negativa"
  },
  "dinero_probable": {
    "conservador": <número>,
    "base": <número>,
    "optimista": <número>,
    "resumen": "<1-2 frases sobre la previsión>"
  },
  "dinero_en_riesgo": {
    "total_estimado": <número>,
    "nivel": "bajo|medio|alto|crítico",
    "clientes_afectados": ["<nombre>"],
    "descripcion": "<qué está en riesgo y por qué>"
  },
  "clientes_prioritarios": [
    { "nombre": "<nombre>", "empresa": "<empresa o null>", "valor_estimado": <número o null>, "accion": "<acción específica>", "urgencia": "urgente|alta|media" }
  ],
  "bloqueadores": [
    { "titulo": "<bloqueador>", "impacto": "alto|medio|bajo", "solucion": "<acción directa para resolverlo>" }
  ],
  "accion_recomendada": {
    "titulo": "<acción principal en máx 6 palabras>",
    "descripcion": "<por qué esta acción tiene mayor retorno>",
    "pasos": ["<paso 1>", "<paso 2>", "<paso 3>"],
    "impacto_estimado": "<resultado esperado en euros o porcentaje>"
  }
}
Máximo 3 clientes prioritarios y 3 bloqueadores. Sé directo y accionable. Sin texto fuera del JSON.`,
    },
    { role: "user", content: context },
  ], {
    model:       "gpt-4o-mini",
    temperature: 0.3,
  });

  logAiCall({
    orgId:        orgId,
    functionName: "executive_report",
    model:        "gpt-4o-mini",
    tokensInput:  result.usage?.promptTokens     ?? 0,
    tokensOutput: result.usage?.completionTokens ?? 0,
  }).catch(() => {});

  const raw = result.text ?? "{}";
  let report: Record<string, unknown>;
  try {
    report = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    res.status(500).json({ error: "Error al parsear respuesta AI" });
    return;
  }

  res.json({ generated_at: now.toISOString(), ...report });
});

// ── POST /ceo — ¿Qué haría un CEO? ───────────────────────────────────────────
executiveRouter.post("/ceo", requirePermission("analytics.read"), async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) { res.status(503).json({ error: "OPENAI_API_KEY no configurada" }); return; }

  const orgId = (req as Request & { orgId?: number }).orgId ?? 1;
  const now = new Date();
  const thirtyAgo    = new Date(now.getTime() - 30 * 86_400_000);
  const sevenFromNow = new Date(now.getTime() + 7  * 86_400_000);

  const [allClients, allQuotes, allAppointments, recentActivity, confirmedValue] = await Promise.all([
    db.select().from(clientsTable).where(eq(clientsTable.orgId, orgId)),
    db.select().from(quotesTable).where(eq(quotesTable.orgId, orgId)),
    db.select().from(appointmentsTable).where(eq(appointmentsTable.orgId, orgId)).orderBy(desc(appointmentsTable.startTime)),
    db.select().from(activityTable).where(and(eq(activityTable.orgId, orgId), gte(activityTable.createdAt, thirtyAgo))).orderBy(desc(activityTable.createdAt)).limit(20),
    getRealConfirmedValue(orgId),
  ]);

  const pipelineQuotes  = allQuotes.filter(q => ["draft", "sent"].includes(q.status));
  const pipelineValue   = pipelineQuotes.reduce((s, q) => s + (q.total ?? 0), 0);
  // FIX-AR: confirmedValue now comes from getRealConfirmedValue() (real payments)
  const inactiveClients = allClients.filter(c => ["inactive", "churned"].includes(c.status));
  const leads           = allClients.filter(c => c.status === "lead");
  const overdueAppts    = allAppointments.filter(a => a.status === "pending" && a.startTime < now);
  const expiringQuotes  = allQuotes.filter(q => q.validUntil && ["draft","sent"].includes(q.status) && q.validUntil <= sevenFromNow && q.validUntil >= now);
  const upcomingAppts   = allAppointments.filter(a => a.startTime >= now && a.startTime <= sevenFromNow);

  const clientLines = allClients.slice(0, 15).map(c => {
    const cq = allQuotes.filter(q => q.clientId === c.id);
    const ca = allAppointments.filter(a => a.clientId === c.id);
    const val = cq.reduce((s, q) => s + (q.total ?? 0), 0);
    return `${c.name}${c.company ? " (" + c.company + ")" : ""}: ${c.status}, €${val} pipeline, ${cq.length} presupuestos, ${ca.length} citas`;
  }).join("\n");

  const quoteLines = pipelineQuotes.slice(0, 6).map(q => {
    const c = allClients.find(cl => cl.id === q.clientId);
    const days = q.validUntil ? Math.ceil((q.validUntil.getTime() - now.getTime()) / 86400000) : null;
    return `"${q.title}" · ${c?.name ?? "?"} · €${q.total?.toLocaleString("es-ES")} · ${q.status}${days !== null ? " · vence en " + days + "d" : ""}`;
  }).join("\n");

  const context = [
    "HOY: " + fmtDate(now),
    "",
    "RESUMEN NEGOCIO:",
    `Pipeline: €${pipelineValue.toLocaleString("es-ES")} | Confirmado (cobrado real): €${confirmedValue.toLocaleString("es-ES")}`,
    `Clientes totales: ${allClients.length} | Activos: ${allClients.filter(c => c.status === "active").length} | Leads: ${leads.length} | En riesgo: ${inactiveClients.length}`,
    `Citas vencidas: ${overdueAppts.length} | Presupuestos expirando esta semana: ${expiringQuotes.length}`,
    `Actividad 30d: ${recentActivity.length} registros`,
    "",
    "CLIENTES:",
    clientLines || "Sin clientes",
    "",
    "PRESUPUESTOS ACTIVOS:",
    quoteLines || "Sin presupuestos activos",
    "",
    "PRÓXIMAS CITAS (7 días):",
    upcomingAppts.length > 0
      ? upcomingAppts.slice(0, 5).map(a => {
          const c = allClients.find(cl => cl.id === a.clientId);
          return `${fmtDate(a.startTime)} ${fmtTime(a.startTime)}: ${a.title} con ${c?.name ?? "?"}`;
        }).join("\n")
      : "Ninguna",
  ].join("\n");

  const aiProvider = getProviderSingleton();
  const result = await aiProvider.generate([
    {
      role: "system",
      content: `Eres un CEO experimentado con mentalidad de máximo retorno económico. Analiza los datos del negocio y da instrucciones directas, sin rodeos.

Devuelve SOLO este JSON (sin texto fuera):
{
  "hacer_hoy": [
    { "accion": "<acción concreta>", "cliente": "<nombre o null>", "impacto_euros": <número o null>, "razon": "<por qué hoy, en 1 frase>" }
  ],
  "no_hacer": [
    { "accion": "<qué evitar>", "razon": "<por qué es una pérdida de tiempo/dinero>" }
  ],
  "cliente_prioritario": {
    "nombre": "<nombre>", "empresa": "<empresa o null>", "valor_potencial": <número o null>,
    "por_que": "<razón en 1 frase directa>", "accion_concreta": "<exactamente qué decirle o hacer>"
  },
  "oportunidad_cerrar": {
    "titulo": "<presupuesto o servicio>", "cliente": "<nombre>", "valor": <número o null>,
    "probabilidad": "muy alta|alta|media", "siguiente_paso": "<acción específica para cerrar>",
    "plazo": "<hoy|esta semana|este mes>"
  },
  "riesgo_eliminar": {
    "titulo": "<riesgo>", "dinero_en_juego": <número o null>,
    "impacto_si_ignoras": "<consecuencia directa>", "accion_hoy": "<qué hacer exactamente>"
  }
}

Reglas:
- hacer_hoy: exactamente 3 acciones, ordenadas de mayor a menor impacto económico
- no_hacer: exactamente 2 cosas
- Sé brutal y directo como un CEO. Sin frases corporativas vacías.
- Todo ordenado por impacto económico real.`,
    },
    { role: "user", content: context },
  ], {
    model:       "gpt-4o-mini",
    temperature: 0.25,
  });

  logAiCall({
    orgId:        orgId,
    functionName: "executive_ceo",
    model:        "gpt-4o-mini",
    tokensInput:  result.usage?.promptTokens     ?? 0,
    tokensOutput: result.usage?.completionTokens ?? 0,
  }).catch(() => {});

  const raw = result.text ?? "{}";
  let decision: Record<string, unknown>;
  try {
    decision = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    res.status(500).json({ error: "Error al parsear respuesta AI" });
    return;
  }

  res.json({ generated_at: now.toISOString(), ...decision });
});
