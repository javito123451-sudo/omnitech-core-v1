import { Router } from "express";
import {
  db, clientsTable, appointmentsTable, quotesTable, activityTable,
} from "@workspace/db";
import { eq, and, desc, gte } from "drizzle-orm";

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
executiveRouter.get("/", async (req, res) => {
  const orgId = (req as Request & { orgId?: number }).orgId ?? 1;
  const now   = new Date();
  const thirtyAgo      = new Date(now.getTime() - 30  * 86_400_000);
  const sevenFromNow   = new Date(now.getTime() + 7   * 86_400_000);

  const [allClients, allQuotes, allAppointments, recentActivity] = await Promise.all([
    db.select().from(clientsTable).where(eq(clientsTable.orgId, orgId)),
    db.select().from(quotesTable).where(eq(quotesTable.orgId, orgId)),
    db.select().from(appointmentsTable).where(eq(appointmentsTable.orgId, orgId))
       .orderBy(desc(appointmentsTable.startTime)),
    db.select().from(activityTable)
       .where(and(eq(activityTable.orgId, orgId), gte(activityTable.createdAt, thirtyAgo)))
       .orderBy(desc(activityTable.createdAt)).limit(50),
  ]);

  // ── KPIs ──────────────────────────────────────────────────────────────────
  const pipelineQuotes  = allQuotes.filter(q => ["draft", "sent"].includes(q.status));
  const acceptedQuotes  = allQuotes.filter(q => q.status === "accepted");
  const closedQuotes    = allQuotes.filter(q => ["accepted","rejected","expired"].includes(q.status));
  const pipelineValue   = pipelineQuotes.reduce((s, q) => s + (q.total ?? 0), 0);
  const confirmedValue  = acceptedQuotes.reduce((s, q) => s + (q.total ?? 0), 0);
  const activeClients   = allClients.filter(c => c.status === "active").length;
  const leadsCount      = allClients.filter(c => c.status === "lead").length;
  const atRiskCount     = allClients.filter(c => ["inactive","churned"].includes(c.status)).length;
  const conversionRate  = closedQuotes.length > 0
    ? Math.round((acceptedQuotes.length / closedQuotes.length) * 100)
    : null;

  const kpis = {
    pipeline_value:  Math.round(pipelineValue),
    confirmed_value: Math.round(confirmedValue),
    active_clients:  activeClients,
    leads:           leadsCount,
    at_risk:         atRiskCount,
    total_clients:   allClients.length,
    conversion_rate: conversionRate,
    total_quotes:    allQuotes.length,
    activity_30d:    recentActivity.length,
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
