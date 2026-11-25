// Plantillas de mensajes: validación (cumplimiento), CRUD y render.
//
// Reglas de cumplimiento aplicadas al GUARDAR una plantilla (heurística: no sustituye
// la responsabilidad del texto, que sigue siendo del cliente; se documenta):
//   · sin incentivos ni recompensas por reseñar (descuentos, sorteos, regalos…);
//   · sin pedir valoraciones positivas ni condicionar la petición a la experiencia
//     («si estás satisfecho…», «5 estrellas»): se pide la opinión, sea cual sea;
//   · WhatsApp: el texto debe indicar cómo darse de baja (responder BAJA);
//   · email: el pie con identificación del remitente y enlace de baja lo añade SIEMPRE el
//     sistema y no se puede quitar.
import { and, desc, eq } from "drizzle-orm";
import { db, reviewTemplatesTable, type REVIEW_CHANNELS } from "@workspace/db";
import { ReviewInputError } from "./locations";

export const TEMPLATE_VARIABLES = ["nombre", "servicio", "establecimiento", "enlace"] as const;
export type TemplateVariable = (typeof TEMPLATE_VARIABLES)[number];

const INCENTIVE_RE = /\b(descuento|dto\.?|cup[oó]n|sorteo|sortear|regalo|obsequio|gratis|gratuit[oa]|premio|recompensa|bonificaci[oó]n|bono|a cambio de|te (damos|regalamos|ofrecemos|sorteamos)|participa en|entras? en el sorteo|ofertas?|promoci[oó]n|\d+\s?(%|€|euros)\s?(de)?\s?(dto|descuento)?|reward|discount|giveaway|free)\b/i;
const FILTERING_RE = /(5 estrellas|cinco estrellas|5 stars|valoraci[oó]n positiva|rese[ñn]a positiva|buena (rese[ñn]a|valoraci[oó]n|puntuaci[oó]n)|punt[uú]anos con (un )?(5|10|cinco)|si (tu|su) experiencia (ha sido|fue) (buena|positiva|satisfactoria)|si (est[aá]s?|queda[sz]?|ha quedado) (satisfech|content)|solo si|[uú]nicamente si)/i;

export interface TemplateInput {
  channel: string; name: string; subject?: string | null; body: string;
  waTemplateName?: string | null; waLanguage?: string | null;
}

export function placeholdersOf(text: string): string[] {
  return [...text.matchAll(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g)].map((m) => m[1]!.toLowerCase());
}

export function validateTemplate(t: TemplateInput): void {
  const bad = (field: string, msg: string) => { throw new ReviewInputError(field, msg); };
  if (t.channel !== "whatsapp" && t.channel !== "email") bad("channel", "Canal no soportado.");
  if (!t.name?.trim()) bad("name", "El nombre es obligatorio.");
  if (!t.body?.trim()) bad("body", "El texto es obligatorio.");
  const max = t.channel === "whatsapp" ? 1024 : 5000;
  if (t.body.length > max) bad("body", `Máximo ${max} caracteres para ${t.channel}.`);
  if (t.channel === "email" && !t.subject?.trim()) bad("subject", "El asunto es obligatorio en email.");
  const text = `${t.subject ?? ""}\n${t.body}`;
  const inc = INCENTIVE_RE.exec(text);
  if (inc) bad("body", `El texto no puede ofrecer incentivos por reseñar (detectado «${inc[0]}»). Las reseñas deben ser voluntarias y sin recompensa.`);
  const fil = FILTERING_RE.exec(text);
  if (fil) bad("body", `El texto no puede pedir una valoración concreta ni condicionar la petición a la satisfacción (detectado «${fil[0]}»). Pide la opinión del cliente, sea cual sea.`);
  const used = new Set(placeholdersOf(text));
  for (const v of used) if (!(TEMPLATE_VARIABLES as readonly string[]).includes(v)) bad("body", `Variable desconocida {{${v}}}. Permitidas: ${TEMPLATE_VARIABLES.join(", ")}.`);
  if (!used.has("enlace")) bad("body", "Incluye {{enlace}}: es el enlace para escribir la reseña.");
  if (t.channel === "whatsapp") {
    if (!/\b(baja|stop)\b/i.test(t.body)) bad("body", "En WhatsApp indica cómo darse de baja (p. ej. «Responde BAJA para no recibir más mensajes»).");
    if (t.waTemplateName && !/^[a-z0-9_]{1,512}$/.test(t.waTemplateName)) bad("waTemplateName", "Nombre de plantilla de Meta inválido (minúsculas, números y _).");
    if (t.waLanguage && !/^[a-z]{2}(_[A-Z]{2})?$/.test(t.waLanguage)) bad("waLanguage", "Idioma inválido (p. ej. es o es_ES).");
  }
}

export async function listTemplates(orgId: number) {
  return db.select().from(reviewTemplatesTable).where(eq(reviewTemplatesTable.orgId, orgId)).orderBy(desc(reviewTemplatesTable.id));
}
export async function getTemplate(orgId: number, id: number) {
  const [r] = await db.select().from(reviewTemplatesTable).where(and(eq(reviewTemplatesTable.orgId, orgId), eq(reviewTemplatesTable.id, id)));
  return r ?? null;
}
export async function createTemplate(orgId: number, userId: number | null, t: TemplateInput) {
  validateTemplate(t);
  const used = [...new Set(placeholdersOf(`${t.subject ?? ""}\n${t.body}`))];
  const [r] = await db.insert(reviewTemplatesTable).values({
    orgId, channel: t.channel as (typeof REVIEW_CHANNELS)[number], name: t.name.trim(), subject: t.subject?.trim() || null, body: t.body,
    variables: used, waTemplateName: t.waTemplateName?.trim() || null, waLanguage: t.waLanguage?.trim() || null,
    waStatus: t.channel === "whatsapp" && t.waTemplateName ? "pending" : null, createdBy: userId,
  }).returning();
  return r!;
}
export async function updateTemplate(orgId: number, id: number, t: TemplateInput) {
  validateTemplate(t);
  const used = [...new Set(placeholdersOf(`${t.subject ?? ""}\n${t.body}`))];
  const [cur] = await db.select().from(reviewTemplatesTable).where(and(eq(reviewTemplatesTable.orgId, orgId), eq(reviewTemplatesTable.id, id)));
  if (!cur) return null;
  if (cur.channel !== t.channel) throw new ReviewInputError("channel", "No se puede cambiar el canal de una plantilla existente.");
  // Si cambia el texto o la plantilla de Meta, la aprobación anterior deja de valer hasta que se vuelva a confirmar.
  const metaChanged = t.waTemplateName !== cur.waTemplateName || t.waLanguage !== cur.waLanguage || t.body !== cur.body;
  const [r] = await db.update(reviewTemplatesTable).set({
    name: t.name.trim(), subject: t.subject?.trim() || null, body: t.body, variables: used,
    waTemplateName: t.waTemplateName?.trim() || null, waLanguage: t.waLanguage?.trim() || null,
    waStatus: t.channel === "whatsapp" ? (t.waTemplateName ? (metaChanged ? "pending" : cur.waStatus) : null) : null, updatedAt: new Date(),
  }).where(and(eq(reviewTemplatesTable.orgId, orgId), eq(reviewTemplatesTable.id, id))).returning();
  return r ?? null;
}

// ── Render ───────────────────────────────────────────────────────────────────
export interface RenderVars { nombre: string; servicio: string; establecimiento: string; enlace: string }

export function renderText(text: string, vars: RenderVars, escape: (s: string) => string = (s) => s): string {
  return text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_m, k: string) => {
    const key = k.toLowerCase() as keyof RenderVars;
    return key in vars ? (key === "enlace" ? vars[key] : escape(vars[key])) : "";
  });
}
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
