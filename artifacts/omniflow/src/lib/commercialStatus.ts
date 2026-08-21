// ── Estado comercial, prioridad y Autopilot — fuente única de verdad ────────────
// Usado por la tabla de clientes, la ficha (ClientProfileDialog) y el dashboard,
// para que ninguna pantalla invente su propio mapa de colores/emojis.
//
// `commercialStatus` es texto libre en BD (no un enum) para poder ampliar esta
// lista sin migración — ver lib/db/src/schema/clients.ts. La lista de abajo es
// solo el catálogo "conocido" para render; un valor fuera de esta lista se
// muestra igualmente (con un estilo neutro), nunca se oculta ni se rechaza.

export interface CommercialStatusDef {
  id: string;
  label: string;
  color: string; // Tailwind text/border/bg classes, mismo estilo que STATUS_COLOR en clients.tsx
}

export const COMMERCIAL_STATUSES: CommercialStatusDef[] = [
  { id: "prospecto",          label: "Prospecto",          color: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
  { id: "contactado",         label: "Contactado",         color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { id: "sin_respuesta",      label: "Sin respuesta",      color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { id: "interesado",         label: "Interesado",         color: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20" },
  { id: "reunion_pendiente",  label: "Reunión pendiente",  color: "bg-purple-500/10 text-purple-400 border-purple-500/20" },
  { id: "propuesta_enviada",  label: "Propuesta enviada",  color: "bg-indigo-500/10 text-indigo-400 border-indigo-500/20" },
  { id: "negociacion",        label: "Negociación",        color: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
  { id: "cliente",            label: "Cliente",            color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" },
  { id: "perdido",            label: "Perdido",            color: "bg-red-500/10 text-red-400 border-red-500/20" },
  { id: "no_contactar",       label: "No contactar",       color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20" },
];

const COMMERCIAL_STATUS_MAP = new Map(COMMERCIAL_STATUSES.map(s => [s.id, s]));

export function getCommercialStatusDef(id: string | null | undefined): CommercialStatusDef {
  if (id && COMMERCIAL_STATUS_MAP.has(id)) return COMMERCIAL_STATUS_MAP.get(id)!;
  return { id: id ?? "prospecto", label: id ?? "Prospecto", color: "bg-slate-500/10 text-slate-400 border-slate-500/20" };
}

// Fallback de solo-lectura para clientes viejos sin commercialStatus — nunca se
// escribe de vuelta a BD, solo se usa para no mostrar la ficha vacía.
const LEGACY_STATUS_FALLBACK: Record<string, string> = {
  lead: "prospecto",
  active: "cliente",
  inactive: "sin_respuesta",
  churned: "perdido",
};

export function deriveCommercialStatus(commercialStatus: string | null | undefined, legacyStatus: string): string {
  if (commercialStatus) return commercialStatus;
  return LEGACY_STATUS_FALLBACK[legacyStatus] ?? "prospecto";
}

export interface PriorityDef {
  id: string;
  label: string;
  color: string;
}

export const PRIORITY_LEVELS: PriorityDef[] = [
  { id: "low",    label: "Baja",    color: "bg-slate-500/10 text-slate-400 border-slate-500/20" },
  { id: "medium", label: "Media",   color: "bg-blue-500/10 text-blue-400 border-blue-500/20" },
  { id: "high",   label: "Alta",    color: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  { id: "urgent", label: "Urgente", color: "bg-red-500/10 text-red-400 border-red-500/20" },
];

const PRIORITY_MAP = new Map(PRIORITY_LEVELS.map(p => [p.id, p]));

export function getPriorityDef(id: string | null | undefined): PriorityDef {
  return PRIORITY_MAP.get(id ?? "medium") ?? PRIORITY_LEVELS[1]!;
}

// ── Estado visual del Autopilot (chip siempre-visible en la ficha + tabla) ──────
// 🟢 activo — enabled=true, pausedReason=null
// 🟡 pendiente de aprobación — hay un mensaje "pending_approval" esperando acción
// 🔴 pausado por respuesta — pausedReason="reply"
// ⚪ inactivo/pausado manual — enabled=false, pausedReason="manual" o nunca activado
export type AutopilotVisualState = "active" | "pending_approval" | "paused_reply" | "inactive";

export const AUTOPILOT_STATE_EMOJI: Record<AutopilotVisualState, string> = {
  active: "🟢",
  pending_approval: "🟡",
  paused_reply: "🔴",
  inactive: "⚪",
};

export const AUTOPILOT_STATE_LABEL: Record<AutopilotVisualState, string> = {
  active: "Autopilot activo",
  pending_approval: "Pendiente de aprobación",
  paused_reply: "Pausado por respuesta",
  inactive: "Autopilot inactivo",
};

export function getAutopilotVisualState(task: {
  enabled: boolean;
  pausedReason: string | null;
} | null | undefined, hasPendingApproval: boolean): AutopilotVisualState {
  if (!task) return "inactive";
  if (task.pausedReason === "reply") return "paused_reply";
  if (!task.enabled) return "inactive";
  if (hasPendingApproval) return "pending_approval";
  return "active";
}
