// Estados de un agente — fuente única para etiquetas y colores (mismo criterio que commercialStatus.ts:
// una lista "conocida" para pintar; un valor fuera de ella se muestra igualmente con estilo neutro, nunca se oculta).
//
// Los estados REALES del backend son draft · published · paused · archived (AGENT_STATUSES). "Simulación" y
// "Testing" no son estados del agente sino modos de ejecución, así que no se pintan como estado.
// Las clases de color reutilizan la paleta de commercialStatus.ts.

import type { AgentStatus } from "./types";

export interface AgentStatusDef {
  id:    string;
  label: string;
  color: string; // clases Tailwind de texto/borde/fondo, mismo estilo que COMMERCIAL_STATUSES
  hint:  string;
}

export const AGENT_STATUS_DEFS: Record<AgentStatus, AgentStatusDef> = {
  draft:     { id: "draft",     label: "Borrador",  color: "bg-slate-500/10 text-slate-400 border-slate-500/20",       hint: "Aún no se ha publicado ninguna versión." },
  published: { id: "published", label: "Publicado", color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20", hint: "Tiene una versión activa." },
  paused:    { id: "paused",    label: "Pausado",   color: "bg-amber-500/10 text-amber-400 border-amber-500/20",       hint: "Pausado: no atiende peticiones." },
  archived:  { id: "archived",  label: "Archivado", color: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",          hint: "Archivado: solo consulta." },
};

const NEUTRAL = "bg-slate-500/10 text-slate-400 border-slate-500/20";

export function getAgentStatusDef(status: string | null | undefined): AgentStatusDef {
  if (status && Object.prototype.hasOwnProperty.call(AGENT_STATUS_DEFS, status)) return AGENT_STATUS_DEFS[status as AgentStatus];
  return { id: status ?? "unknown", label: status ?? "Desconocido", color: NEUTRAL, hint: "Estado no reconocido por esta versión de la interfaz." };
}
