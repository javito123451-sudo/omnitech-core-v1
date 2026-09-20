// Formato de las pantallas de agentes. OmniCredits es la unidad que ve el cliente: créditos, sin conversión a dinero.

import type { Agent, DefaultAgent } from "./types";

const credits = new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2, useGrouping: "always" } as Intl.NumberFormatOptions);

/** 50000 → "50.000"; 999.9 → "999,9". */
export const formatCredits = (n: number | null | undefined): string => (n === null || n === undefined ? "—" : credits.format(n));

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("es-ES", { day: "numeric", month: "long", year: "numeric" });
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("es-ES", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const CHANNEL_LABELS: Record<string, string> = {
  all: "todos los canales", web: "Web", crm: "CRM", super_admin: "Super Admin", telegram: "Telegram", whatsapp: "WhatsApp", email: "Email",
};
export const channelLabel = (c: string): string => CHANNEL_LABELS[c] ?? c;

/** Canales para los que este agente es el agente por defecto ("all" = todo el workspace). */
export function defaultChannelsOf(agentId: number, defaults: DefaultAgent[] | undefined): string[] {
  return (defaults ?? []).filter((d) => d.agentId === agentId).map((d) => d.channel);
}

/** Presupuesto del agente en créditos, o null si no tiene ningún tope. */
export function budgetSummary(a: Pick<Agent, "monthlyCreditLimit" | "dailyCreditLimit" | "perExecutionCreditLimit">): string | null {
  const parts: string[] = [];
  if (a.monthlyCreditLimit !== null) parts.push(`${formatCredits(a.monthlyCreditLimit)} al mes`);
  if (a.dailyCreditLimit !== null) parts.push(`${formatCredits(a.dailyCreditLimit)} al día`);
  if (a.perExecutionCreditLimit !== null) parts.push(`${formatCredits(a.perExecutionCreditLimit)} por ejecución`);
  return parts.length ? parts.join(" · ") : null;
}
