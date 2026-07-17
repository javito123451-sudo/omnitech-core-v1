// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Deterministic Response Formatters
//  NO LLM dependency — pure code, pure data from Skill Engine
//  Used exclusively by the Ava chat route (POST /api/chat)
// ═══════════════════════════════════════════════════════════════════════════

import type { SkillResult } from "../skills/types";

// ── Minimal memory entry interface (avoids coupling to DB schema types) ──────
export interface MemoryEntry {
  memoryKey: string;
  memoryVal: string;
  title?: string | null;
  category?: string | null;
}

// ── Currency helper ──────────────────────────────────────────────────────────
function fmtEur(n: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency", currency: "EUR", maximumFractionDigits: 0,
  }).format(n);
}

// ── Timezone display helpers ─────────────────────────────────────────────────
function displayTime(isoStr: string): string {
  try {
    return new Date(isoStr).toLocaleTimeString("es-ES", {
      hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Europe/Madrid",
    });
  } catch { return isoStr; }
}

// ═══════════════════════════════════════════════════════════════════════════
// Main dispatcher
// ═══════════════════════════════════════════════════════════════════════════

export function formatSkillResponse(
  skillId:  string,
  result:   SkillResult,
  params:   Record<string, unknown>,
): string {
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(result.result) as Record<string, unknown>; } catch { data = {}; }

  if (data["error"]) {
    const errorMsg = String(data["error"]);
    if (errorMsg.startsWith("Parámetros faltantes:")) {
      const missing = errorMsg.replace("Parámetros faltantes:", "").trim();
      return buildMissingParamsMsg(skillId, missing);
    }
    return `❌ **No se pudo completar la acción**\n\n${errorMsg}\n\n💡 Revisa los datos e inténtalo de nuevo.`;
  }

  switch (skillId) {
    case "create_appointment":     return formatCreateAppointment(data);
    case "reschedule_appointment": return formatRescheduleAppointment(data);
    case "cancel_appointment":     return formatCancelAppointment(data);
    case "get_appointments":
    case "get_client_appointments":return formatGetAppointments(data, params);
    case "list_clients":
    case "get_clients":            return formatListClients(data);
    case "create_client":          return formatCreateClient(data);
    case "get_client":             return formatGetClient(data);
    case "create_quote":           return formatCreateQuote(data);
    case "list_quotes":
    case "get_quotes":             return formatListQuotes(data);
    case "create_task":            return formatCreateTask(data);
    case "list_tasks":
    case "get_tasks":              return formatListTasks(data);
    case "accounting_summary":     return formatAccountingSummary(data);
    case "list_pending_invoices":
    case "list_invoices":
    case "get_pending_invoices":   return formatListInvoices(data);
    case "create_invoice":         return formatCreateInvoice(data);
    case "register_payment":       return formatRegisterPayment(data);
    case "get_client_debt":        return formatClientDebt(data);
    case "get_monthly_income":     return formatMonthlyIncome(data);
    default:
      return String(data["message"] ?? result.result);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Appointment formatters
// ═══════════════════════════════════════════════════════════════════════════

function formatCreateAppointment(data: Record<string, unknown>): string {
  const title      = String(data["title"]      ?? "Cita");
  const clientName = String(data["clientName"] ?? "");
  const date       = String(data["date"]       ?? "");
  const time       = String(data["time"]       ?? "");
  const duration   = Number(data["duration"]   ?? 60);
  const apptType   = String(data["type"]       ?? "meeting");
  const location   = data["location"] ? String(data["location"]) : null;

  const typeLabel: Record<string, string> = {
    meeting: "Reunión", call: "Llamada", demo: "Demo",
    follow_up: "Seguimiento", other: "Otro",
  };

  let text = `✅ **Cita agendada con éxito**\n\n`;
  text += `📋 **${title}**\n`;
  text += `👤 ${clientName} · ${typeLabel[apptType] ?? apptType}\n`;
  text += `📅 ${date} a las **${time}**\n`;
  text += `⏱ Duración: ${duration} minutos\n`;
  if (location) text += `📍 ${location}\n`;
  text += `\n🔗 [Ver en Calendario →](/calendar)\n`;
  text += `\n🚀 **Siguiente paso:** Confirma la cita con el cliente.`;
  return text;
}

function formatRescheduleAppointment(data: Record<string, unknown>): string {
  const title    = String(data["title"]   ?? "Cita");
  const newDate  = String(data["newDate"] ?? "");
  const newTime  = String(data["newTime"] ?? "");
  const duration = Number(data["duration"] ?? 60);

  return [
    `🔄 **Cita reprogramada con éxito**`,
    ``,
    `La cita **${title}** ha sido reprogramada:`,
    `📅 Nueva fecha: **${newDate} a las ${newTime}**`,
    `⏱ Duración: ${duration} minutos`,
    ``,
    `🔗 [Ver en Calendario →](/calendar)`,
  ].join("\n");
}

function formatCancelAppointment(data: Record<string, unknown>): string {
  const title  = String(data["title"]  ?? "Cita");
  const date   = String(data["cancelledDate"] ?? data["date"] ?? "");
  const time   = String(data["cancelledTime"] ?? data["time"] ?? "");
  const reason = data["reason"] ? String(data["reason"]) : null;

  let text = `❌ **Cita cancelada**\n\n`;
  text += `La cita **${title}** (${date} ${time}) ha sido cancelada correctamente.\n`;
  if (reason) text += `\n🔎 Motivo: ${reason}\n`;
  text += `\n🔗 [Ver Calendario →](/calendar)`;
  return text;
}

function formatGetAppointments(
  data:   Record<string, unknown>,
  params: Record<string, unknown>,
): string {
  const total       = Number(data["total"] ?? 0);
  const dateFilter  = String(data["date_filter"] ?? params["date_filter"] ?? "all");
  const appointments = (data["appointments"] as {
    id: number; title: string; startTime: string; status: string;
    statusLabel?: string; type?: string | null;
    clientName?: string | null; location?: string | null;
  }[]) ?? [];

  const filterLabel: Record<string, string> = {
    today: "Hoy", tomorrow: "Mañana", this_week: "Esta semana",
    upcoming: "Próximas", past: "Pasadas", all: "Todas",
  };

  let text = `📅 **Citas — ${filterLabel[dateFilter] ?? dateFilter}** (${total})\n\n`;

  if (total === 0) {
    text += `No hay citas para este período.\n\n🔗 [Ir al Calendario →](/calendar)`;
    return text;
  }

  for (const a of appointments.slice(0, 10)) {
    const time    = a.startTime ? displayTime(a.startTime) : "—";
    const sLabel  = a.statusLabel ?? "·";
    text += `${sLabel} **${time}** — ${a.title}`;
    if (a.clientName) text += ` · *${a.clientName}*`;
    if (a.location)   text += ` · 📍${a.location}`;
    text += "\n";
  }

  if (total > 10) text += `\n*...y ${total - 10} más*\n`;
  text += `\n🔗 [Ver en Calendario →](/calendar)`;
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
// Client formatters
// ═══════════════════════════════════════════════════════════════════════════

function formatListClients(data: Record<string, unknown>): string {
  const total      = Number(data["total"] ?? 0);
  const totalValue = Number(data["totalValue"] ?? 0);
  const clients    = (data["clients"] as {
    id: number; name: string; company?: string | null;
    status: string; label?: string; value?: number;
  }[]) ?? [];
  const byStatus   = (data["byStatus"] as { status: string; label: string; count: number }[]) ?? [];

  const statusLine = byStatus.map(s => `${s.count} ${s.label.toLowerCase()}`).join(" · ");
  const statusEmoji: Record<string, string> = {
    active: "✅", lead: "🔵", prospect: "🟡", inactive: "⚪", churned: "❌",
  };

  let text = `👥 **Clientes del CRM** — ${total} total`;
  if (statusLine)    text += ` (${statusLine})`;
  if (totalValue > 0) text += `\n💰 Cartera total: **${fmtEur(totalValue)}**`;
  text += "\n\n";

  if (total === 0) {
    text += "No hay clientes registrados.\n\n🔗 [Ir a Clientes →](/clients)";
    return text;
  }

  for (const c of clients.slice(0, 8)) {
    const emoji = statusEmoji[c.status] ?? "·";
    text += `${emoji} **${c.name}**`;
    if (c.company)        text += ` · ${c.company}`;
    if ((c.value ?? 0) > 0) text += ` · ${fmtEur(c.value!)}`;
    text += "\n";
  }

  if (total > 8) text += `\n*...y ${total - 8} más*\n`;
  text += `\n🔗 [Ver todos los clientes →](/clients)`;
  return text;
}

function formatCreateClient(data: Record<string, unknown>): string {
  const name    = String(data["name"]    ?? "Cliente");
  const company = data["company"] ? String(data["company"]) : null;
  const email   = data["email"]   ? String(data["email"])   : null;
  const phone   = data["phone"]   ? String(data["phone"])   : null;
  const updated = Boolean(data["updated"]);

  let text = updated
    ? `🔄 **Cliente actualizado**\n\n`
    : `✅ **Cliente registrado con éxito**\n\n`;
  text += `👤 **${name}**\n`;
  if (company) text += `🏢 ${company}\n`;
  if (email)   text += `📧 ${email}\n`;
  if (phone)   text += `📞 ${phone}\n`;
  text += `\n🔗 [Ver en CRM →](/clients)`;
  return text;
}

function formatGetClient(data: Record<string, unknown>): string {
  const name    = String(data["name"]    ?? "Cliente");
  const company = data["company"] ? String(data["company"]) : null;
  const email   = data["email"]   ? String(data["email"])   : null;
  const phone   = data["phone"]   ? String(data["phone"])   : null;
  const value   = Number(data["value"]   ?? 0);
  const label   = String(data["label"]   ?? data["status"] ?? "");
  const notes   = data["notes"]   ? String(data["notes"])   : null;

  let text = `👤 **${name}**`;
  if (company) text += ` · ${company}`;
  text += `\n📊 Estado: ${label}`;
  if (value > 0) text += ` · 💰 ${fmtEur(value)}`;
  if (email) text += `\n📧 ${email}`;
  if (phone) text += `\n📞 ${phone}`;
  if (notes) text += `\n\n📝 *${notes.slice(0, 200)}${notes.length > 200 ? "..." : ""}*`;
  text += `\n\n🔗 [Ver ficha →](/clients)`;
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
// Quote formatters
// ═══════════════════════════════════════════════════════════════════════════

function formatCreateQuote(data: Record<string, unknown>): string {
  const quoteNumber = String(data["quoteNumber"] ?? "—");
  const clientName  = String(data["clientName"]  ?? "");
  const title       = String(data["title"]       ?? "Presupuesto");
  const total       = Number(data["total"]       ?? 0);
  const taxRate     = Number(data["taxRate"]     ?? 21);
  const validUntil  = data["validUntil"] ? String(data["validUntil"]) : null;
  const items       = (data["items"] as { description: string; quantity: number; unitPrice: number; total: number }[]) ?? [];

  let text = `📋 **Presupuesto #${quoteNumber} creado**\n\n`;
  text += `👤 ${clientName} · *${title}*\n`;
  if (validUntil) text += `📅 Válido hasta: ${validUntil}\n`;
  text += "\n";

  if (items.length > 0) {
    text += `**Conceptos:**\n`;
    for (const item of items.slice(0, 5)) {
      text += `- ${item.description} — ${item.quantity} × ${fmtEur(item.unitPrice)} = **${fmtEur(item.total)}**\n`;
    }
    text += "\n";
  }

  text += `💰 **Total: ${fmtEur(total)}** (IVA ${taxRate}% incluido)\n`;
  text += `\n🔗 [Ver presupuesto →](/quotes)`;
  return text;
}

function formatListQuotes(data: Record<string, unknown>): string {
  const total  = Number(data["total"] ?? 0);
  const quotes = (data["quotes"] as {
    id: number; title: string; status: string;
    total: number | string; validUntil?: string | null; clientName?: string | null;
  }[]) ?? [];

  const statusEmoji: Record<string, string> = {
    draft: "📝", sent: "📬", accepted: "✅", rejected: "❌", expired: "⏰",
  };

  let text = `📋 **Presupuestos** — ${total} total\n\n`;

  if (total === 0) {
    text += "No hay presupuestos.\n\n🔗 [Ir a Presupuestos →](/quotes)";
    return text;
  }

  for (const q of quotes.slice(0, 8)) {
    const emoji = statusEmoji[q.status] ?? "·";
    text += `${emoji} **${q.clientName ?? "—"}** · ${q.title}`;
    if (q.total)    text += ` · **${fmtEur(Number(q.total))}**`;
    if (q.validUntil) text += ` · vence ${q.validUntil}`;
    text += "\n";
  }

  if (total > 8) text += `\n*...y ${total - 8} más*\n`;
  text += `\n🔗 [Ver todos →](/quotes)`;
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
// Task formatters
// ═══════════════════════════════════════════════════════════════════════════

function formatCreateTask(data: Record<string, unknown>): string {
  const title      = String(data["title"]      ?? "Tarea");
  const priority   = String(data["priority"]   ?? "medium");
  const dueDate    = data["dueDate"]    ? String(data["dueDate"])    : null;
  const clientName = data["clientName"] ? String(data["clientName"]) : null;

  const priorityLabel: Record<string, string> = {
    low: "🟢 Baja", medium: "🟡 Media", high: "🔴 Alta",
  };

  let text = `✅ **Tarea creada**\n\n`;
  text += `📝 **${title}**\n`;
  text += `⚡ Prioridad: ${priorityLabel[priority] ?? priority}\n`;
  if (dueDate)    text += `📅 Vence: ${dueDate}\n`;
  if (clientName) text += `👤 Cliente: ${clientName}\n`;
  text += `\n🔗 [Ver tareas →](/tasks)`;
  return text;
}

function formatListTasks(data: Record<string, unknown>): string {
  const total = Number(data["total"] ?? 0);
  const tasks = (data["tasks"] as {
    id: number; title: string; status: string; priority: string;
    dueDate?: string | null; clientName?: string | null;
  }[]) ?? [];

  const priorityEmoji: Record<string, string> = { low: "🟢", medium: "🟡", high: "🔴" };
  const statusEmoji:   Record<string, string> = {
    pending: "⏳", in_progress: "🔄", completed: "✅", cancelled: "❌",
  };

  let text = `📋 **Tareas** — ${total}\n\n`;

  if (total === 0) {
    text += "No hay tareas registradas.\n\n🔗 [Ir a Tareas →](/tasks)";
    return text;
  }

  for (const t of tasks.slice(0, 8)) {
    const sEmoji = statusEmoji[t.status]   ?? "·";
    const pEmoji = priorityEmoji[t.priority] ?? "";
    text += `${sEmoji} ${pEmoji} **${t.title}**`;
    if (t.clientName) text += ` · *${t.clientName}*`;
    if (t.dueDate)    text += ` · vence ${t.dueDate}`;
    text += "\n";
  }

  if (total > 8) text += `\n*...y ${total - 8} más*\n`;
  text += `\n🔗 [Ver todas →](/tasks)`;
  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
// Accounting formatters
// ═══════════════════════════════════════════════════════════════════════════

function formatAccountingSummary(data: Record<string, unknown>): string {
  const pending    = Number(data["pendingTotal"]   ?? data["totalPending"]   ?? 0);
  const overdue    = Number(data["overdueTotal"]   ?? data["totalOverdue"]   ?? 0);
  const paidMonth  = Number(data["paidThisMonth"]  ?? data["totalPaidMonth"] ?? 0);

  let text = `💰 **Resumen Financiero**\n\n`;
  text += `📬 Pendiente de cobro: **${fmtEur(pending)}**\n`;
  if (overdue > 0) text += `⚠️ Vencido sin pagar: **${fmtEur(overdue)}**\n`;
  text += `✅ Cobrado este mes: **${fmtEur(paidMonth)}**\n`;
  text += `\n🔗 [Ver Contabilidad →](/accounting)`;
  return text;
}

function formatListInvoices(data: Record<string, unknown>): string {
  const count        = Number(data["count"] ?? 0);
  const pendingTotal = Number(data["pendingTotal"] ?? 0);
  const invoices     = (data["invoices"] as {
    invoiceNumber: string; client: string; total: number;
    status: string; dueDate?: string | null; overdue?: boolean;
  }[]) ?? [];

  let text = `📄 **Facturas pendientes** — ${count}`;
  if (pendingTotal > 0) text += ` · **${fmtEur(pendingTotal)}** en total`;
  text += "\n\n";

  if (count === 0) {
    text += "No hay facturas pendientes. ✅\n\n🔗 [Ver Contabilidad →](/accounting)";
    return text;
  }

  for (const inv of invoices.slice(0, 8)) {
    const icon = inv.overdue ? "⚠️" : "📬";
    text += `${icon} **${inv.invoiceNumber}** · ${inv.client} · ${fmtEur(inv.total)}`;
    if (inv.dueDate) text += ` · vence ${inv.dueDate}`;
    text += "\n";
  }

  if (count > 8) text += `\n*...y ${count - 8} más*\n`;
  text += `\n🔗 [Ver Contabilidad →](/accounting)`;
  return text;
}

function formatCreateInvoice(data: Record<string, unknown>): string {
  const invoiceNumber = String(data["invoiceNumber"] ?? "—");
  const clientName    = String(data["clientName"]    ?? "");
  const total         = Number(data["total"]         ?? 0);

  return [
    `📄 **Factura ${invoiceNumber} creada**`,
    ``,
    `👤 ${clientName} · 💰 **${fmtEur(total)}**`,
    ``,
    `🔗 [Ver en Contabilidad →](/accounting)`,
  ].join("\n");
}

function formatRegisterPayment(data: Record<string, unknown>): string {
  const amount        = Number(data["amount"]        ?? 0);
  const invoiceNumber = String(data["invoiceNumber"] ?? "—");
  const message       = data["message"] ? String(data["message"]) : "";

  return [
    `💳 **Pago registrado**`,
    ``,
    `**${fmtEur(amount)}** en factura ${invoiceNumber}`,
    message,
    ``,
    `🔗 [Ver Contabilidad →](/accounting)`,
  ].filter(Boolean).join("\n");
}

function formatClientDebt(data: Record<string, unknown>): string {
  const clientName = String(data["clientName"] ?? "");
  const totalDebt  = Number(data["totalDebt"]  ?? 0);
  const message    = data["message"] ? String(data["message"]) : "";

  return `💰 **Deuda de ${clientName}**: **${fmtEur(totalDebt)}**\n\n${message}\n\n🔗 [Ver Contabilidad →](/accounting)`;
}

function formatMonthlyIncome(data: Record<string, unknown>): string {
  const total   = Number(data["total"]   ?? 0);
  const message = data["message"] ? String(data["message"]) : "";

  return `📈 **Ingresos**: **${fmtEur(total)}**\n\n${message}\n\n🔗 [Ver Contabilidad →](/accounting)`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Missing params helper (ask for what's missing without LLM)
// ═══════════════════════════════════════════════════════════════════════════

function buildMissingParamsMsg(skillId: string, missing: string): string {
  const MAP: Record<string, Record<string, string>> = {
    "create_appointment": {
      "date":        "Para agendar la cita necesito la **fecha**. ¿Qué día la ponemos? (ej: 'el martes', '2026-07-22')",
      "client_name": "¿Con **qué cliente** es la cita? Indícame el nombre.",
      "title":       "¿Cómo llamamos a la cita? (ej: 'Reunión de seguimiento')",
    },
    "reschedule_appointment": {
      "new_date":       "¿A qué **nueva fecha** la movemos? (ej: 'el jueves', '2026-07-24')",
      "new_start_time": "¿A qué **hora** la movemos? (ej: '10:00', '15:30')",
    },
    "create_client": {
      "name": "¿Cuál es el **nombre** del cliente que quieres registrar?",
    },
    "create_task": {
      "title": "¿Cuál es el **título** de la tarea que quieres crear?",
    },
    "create_quote": {
      "items":              "Para crear un presupuesto necesito los conceptos (descripción, cantidad y precio). Ve a [Presupuestos →](/quotes) para añadirlos con detalle.",
      "client_name,items":  "Para crear un presupuesto necesito el **cliente** y los **conceptos**. Ve a [Presupuestos →](/quotes) para crearlo completo.",
    },
    "create_invoice": {
      "items":             "Para crear una factura necesito los conceptos. Ve a [Contabilidad →](/accounting) para crearla con detalle.",
      "client_name,items": "Para crear una factura necesito el **cliente** y los **conceptos**. Ve a [Contabilidad →](/accounting).",
    },
  };

  const skillMap = MAP[skillId];
  if (skillMap) {
    const msg = skillMap[missing] ?? skillMap[missing.split(",")[0]!.trim()];
    if (msg) return msg;
  }

  return `Necesito más información: **${missing}**. Por favor, proporciona los datos faltantes.`;
}

// ═══════════════════════════════════════════════════════════════════════════
// Executive (strategic) report — deterministic formatter
// Replaces the GPT-generated narrative with structured data from the DB
// ═══════════════════════════════════════════════════════════════════════════

export function formatExecutiveResponse(
  clientsData:  string,
  upcomingData: string,
  _pendingData: string,
  _activityData: string,
  strategicData: string,
): string {
  let strategic: Record<string, unknown> = {};
  let upcoming:  Record<string, unknown>  = {};

  try { strategic = JSON.parse(strategicData) as Record<string, unknown>; } catch {}
  try { upcoming  = JSON.parse(upcomingData)  as Record<string, unknown>; } catch {}

  const kpis        = strategic["kpis"]                 as Record<string, number> | undefined;
  const topClients  = (strategic["top_clients_by_score"] as any[] | undefined) ?? [];
  const risks       = (strategic["main_risks"]           as string[]  | undefined) ?? [];
  const upcomingArr = (upcoming["appointments"]           as any[] | undefined) ?? [];

  const now     = new Date();
  const dateStr = now.toLocaleDateString("es-ES", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
    timeZone: "Europe/Madrid",
  });

  let text = `📊 **Estado del Negocio** — *${dateStr}*\n\n`;

  if (kpis) {
    text += `**Indicadores Clave**\n`;
    text += `👥 Clientes: **${kpis["total_clients"] ?? 0}**`;
    text += ` (${kpis["active_clients"] ?? 0} activos`;
    text += `, ${kpis["leads"] ?? 0} prospectos`;
    if (kpis["at_risk"]) text += `, ${kpis["at_risk"]} en riesgo`;
    text += `)\n`;
    if ((kpis["pipeline_eur"] ?? 0) > 0)
      text += `💰 Pipeline: **${fmtEur(kpis["pipeline_eur"]!)}** · Confirmado: **${fmtEur(kpis["confirmed_eur"] ?? 0)}**\n`;
    if ((kpis["total_quotes"] ?? 0) > 0)
      text += `📋 Presupuestos activos: **${kpis["total_quotes"]}**\n`;
    if ((kpis["activity_30d"] ?? 0) > 0)
      text += `📈 Actividad (30 días): **${kpis["activity_30d"]}** interacciones\n`;
    text += "\n";
  }

  if (topClients.length > 0) {
    text += `---\n\n🏆 **Top Clientes por Prioridad**\n\n`;
    const medals = ["🥇", "🥈", "🥉"];
    for (let i = 0; i < Math.min(3, topClients.length); i++) {
      const c   = topClients[i]!;
      const med = medals[i] ?? "·";
      text += `${med} **${c.name}** _(Score: ${c.score}/100)_\n`;
      if (c.company || c.value)
        text += `   🏢 ${c.company ?? "—"}${c.value ? ` · 💰 ${fmtEur(c.value)}` : ""}\n`;
      text += `   🚀 *${c.recommended_action}*\n`;
      if (c.sent_quotes?.length > 0)
        text += `   📋 ${c.sent_quotes.length} presupuesto(s) enviado(s)\n`;
      text += "\n";
    }
  }

  if (upcomingArr.length > 0) {
    text += `---\n\n📅 **Próximas Citas** (${upcomingArr.length})\n\n`;
    for (const a of upcomingArr.slice(0, 4)) {
      const timeStr = a.startTime
        ? new Date(a.startTime).toLocaleString("es-ES", {
            weekday: "short", day: "numeric", month: "short",
            hour: "2-digit", minute: "2-digit", timeZone: "Europe/Madrid",
          })
        : "—";
      text += `📍 **${a.title}** · *${a.clientName ?? "sin cliente"}* · ${timeStr}\n`;
    }
    text += "\n";
  }

  if (risks.length > 0) {
    text += `---\n\n⚠️ **Riesgos Identificados**\n\n`;
    for (const r of risks) text += `- ${r}\n`;
    text += "\n";
  }

  const top = topClients[0];
  if (top) {
    text += `---\n\n🚀 **Acción Prioritaria Ahora:**\n`;
    text += `Enfócate en **${top.name}** — ${top.recommended_action}`;
    if (top.value) text += ` _(${fmtEur(top.value)} en juego)_`;
    text += ".";
  } else {
    text += `\n🔗 [Ver Dashboard →](/executive-dashboard)`;
  }

  return text;
}

// ═══════════════════════════════════════════════════════════════════════════
// Conversational responses (no skill needed)
// ═══════════════════════════════════════════════════════════════════════════

export function buildGreetingResponse(memories: MemoryEntry[]): string {
  const now  = new Date();
  const hour = parseInt(
    now.toLocaleTimeString("es-ES", { hour: "2-digit", timeZone: "Europe/Madrid" }),
    10,
  );
  const saludo = hour < 12 ? "Buenos días" : hour < 20 ? "Buenas tardes" : "Buenas noches";

  return [
    `👋 **¡${saludo}!** Soy **Ava**, tu asistente de OmniTech Core.`,
    ``,
    `Puedo ayudarte a gestionar tu CRM directamente desde aquí:`,
    ``,
    `📅 **Citas** — *"Ver citas de hoy"* · *"Agenda una cita con [cliente] el [día]"*`,
    `👥 **Clientes** — *"Mis clientes activos"* · *"Dar de alta a [nombre]"*`,
    `📋 **Presupuestos** — *"Ver mis presupuestos"*`,
    `📋 **Tareas** — *"Mis tareas pendientes"* · *"Crear tarea: [descripción]"*`,
    `📊 **Análisis** — *"¿Cómo va mi negocio?"* · *"¿Qué debo hacer hoy?"*`,
    ``,
    `¿En qué puedo ayudarte?`,
  ].join("\n");
}

export function buildHelpResponse(): string {
  return [
    `## 🤖 Qué puedo hacer por ti`,
    ``,
    `### 📅 Citas y Agenda`,
    `- *"Ver mis citas de hoy"* — Listado del día`,
    `- *"Citas de esta semana"* — Vista semanal`,
    `- *"Agenda una cita con [cliente] el [fecha] a las [hora]"* — Crear cita`,
    `- *"Cancela la cita de [cliente]"* — Cancelar cita`,
    `- *"Reprograma la cita para el [fecha]"* — Cambiar fecha/hora`,
    ``,
    `### 👥 Clientes`,
    `- *"Mis clientes"* / *"Clientes activos"* — Ver CRM`,
    `- *"Dar de alta un cliente"* — Nuevo cliente`,
    ``,
    `### 📋 Presupuestos`,
    `- *"Ver mis presupuestos"* — Listado`,
    `- Ve a [Presupuestos →](/quotes) para crearlos con detalle`,
    ``,
    `### 📋 Tareas`,
    `- *"Mis tareas pendientes"* — Ver tareas`,
    `- *"Crear tarea: [descripción]"* — Nueva tarea`,
    ``,
    `### 📊 Análisis`,
    `- *"¿Cómo va mi negocio?"* — Resumen ejecutivo completo`,
    `- *"¿Qué debo hacer hoy?"* — Prioridades del día`,
    `- *"Ingresos del mes"* — Resumen financiero`,
    ``,
    `---`,
    `💡 Escríbeme en lenguaje natural — entiendo español.`,
  ].join("\n");
}

export function buildFallbackResponse(query: string, memories: MemoryEntry[]): string {
  const words    = query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  const relevant = memories.filter(m => {
    const text = `${m.memoryKey} ${m.memoryVal} ${m.category ?? ""}`.toLowerCase();
    return words.some(w => text.includes(w));
  });

  if (relevant.length > 0) {
    let text = `💡 **Encontré esto en la memoria del equipo:**\n\n`;
    for (const m of relevant.slice(0, 3)) {
      const label = m.title
        ?? m.memoryKey.replace(/^[^:]+:/, "").replace(/_/g, " ");
      text += `**${label}:** ${m.memoryVal}\n\n`;
    }
    return text.trim();
  }

  return [
    `No he podido identificar una acción específica para tu solicitud.`,
    ``,
    `💡 **Puedo ayudarte con:**`,
    `- Citas: *"Ver citas de hoy"* · *"Agenda una cita con [cliente]"*`,
    `- Clientes: *"Mis clientes"* · *"Dar de alta a [nombre]"*`,
    `- Presupuestos: *"Ver mis presupuestos"*`,
    `- Tareas: *"Mis tareas pendientes"* · *"Crear tarea: [texto]"*`,
    `- Análisis: *"¿Cómo va mi negocio?"*`,
    ``,
    `¿Qué necesitas exactamente?`,
  ].join("\n");
}
