// Comparación de dos versiones reales (AgentConfig), campo a campo y agrupada por sección.
//
// No compara el JSON entero: cada campo se compara por separado, así una diferencia dentro de una sección nunca se
// oculta. Las listas se comparan por elementos (añadidos / eliminados; «reordenada» si solo cambia el orden).
// Un campo ausente en una versión antigua cuenta como vacío. El nombre y la descripción del agente no están
// versionados (viven en la fila del agente), por eso no aparecen aquí.

import { channelLabel } from "./format";
import type { AgentConfig } from "./types";

export type ChangeKind = "added" | "removed" | "modified" | "reordered";

export interface FieldChange {
  label:        string;
  kind:         ChangeKind;
  before:       string | null;     // valores escalares
  after:        string | null;
  addedItems:   string[];          // listas
  removedItems: string[];
}

export interface SectionDiff {
  id:      string;
  title:   string;
  changes: FieldChange[];          // vacío = «Sin cambios»
}

type Cfg = Partial<AgentConfig> | null | undefined;
type Scalar = string | number | boolean | null | undefined;

interface ScalarField { label: string; kind: "scalar"; get: (c: Partial<AgentConfig>) => Scalar; show?: (v: Scalar) => string }
interface ListField   { label: string; kind: "list";   get: (c: Partial<AgentConfig>) => string[] | undefined }
type FieldSpec = ScalarField | ListField;

const yesNo = (v: Scalar) => (v === true ? "Sí" : v === false ? "No" : "");

const SPEC: Array<{ id: string; title: string; fields: FieldSpec[] }> = [
  { id: "identity", title: "Identidad", fields: [
    { label: "Rol", kind: "scalar", get: (c) => c.identity?.role },
  ] },
  { id: "objective", title: "Objetivo", fields: [
    { label: "Qué hace", kind: "scalar", get: (c) => c.objective?.what },
    { label: "Audiencia", kind: "scalar", get: (c) => c.objective?.audience },
    { label: "Resultado esperado", kind: "scalar", get: (c) => c.objective?.expectedOutcome },
  ] },
  { id: "personality", title: "Personalidad", fields: [
    { label: "Tono", kind: "scalar", get: (c) => c.personality?.tone },
    { label: "Estilo", kind: "scalar", get: (c) => c.personality?.style },
    { label: "Idioma", kind: "scalar", get: (c) => c.personality?.language },
    { label: "Formalidad", kind: "scalar", get: (c) => c.personality?.formality },
  ] },
  { id: "behavior", title: "Comportamiento", fields: [
    { label: "Instrucciones", kind: "scalar", get: (c) => c.behavior?.instructions },
    { label: "Reglas", kind: "list", get: (c) => c.behavior?.rules },
    { label: "Restricciones", kind: "list", get: (c) => c.behavior?.restrictions },
    { label: "Evitar", kind: "list", get: (c) => c.behavior?.avoid },
  ] },
  { id: "context", title: "Empresa y contexto", fields: [
    { label: "Contexto del negocio", kind: "scalar", get: (c) => c.businessContext },
  ] },
  { id: "parameters", title: "Parámetros", fields: [
    { label: "Temperatura", kind: "scalar", get: (c) => c.parameters?.temperature },
    { label: "Tokens máximos de salida", kind: "scalar", get: (c) => c.parameters?.maxOutputTokens },
    { label: "Rondas de herramientas", kind: "scalar", get: (c) => c.parameters?.maxToolRounds },
    { label: "Mensajes de historial", kind: "scalar", get: (c) => c.parameters?.maxHistoryMessages },
  ] },
  { id: "channels", title: "Canales", fields: [
    { label: "Canales", kind: "list", get: (c) => c.channels?.map(channelLabel) },
  ] },
  // Se editan en otra parte (o todavía no se editan) pero se COPIAN entre versiones y al restaurar: no se ocultan.
  { id: "other", title: "Modelo, conocimiento, herramientas y permisos", fields: [
    { label: "Proveedor", kind: "scalar", get: (c) => c.model?.provider },
    { label: "Modelo", kind: "scalar", get: (c) => c.model?.model },
    { label: "Modelos de respaldo", kind: "list", get: (c) => c.model?.fallbacks?.map((f) => `${f.provider ?? "—"}/${f.model ?? "—"}`) },
    { label: "Todo el conocimiento del workspace", kind: "scalar", get: (c) => c.knowledge?.workspace, show: yesNo },
    { label: "Entradas de conocimiento", kind: "list", get: (c) => c.knowledge?.entryIds?.map(String) },
    { label: "Categorías de conocimiento", kind: "list", get: (c) => c.knowledge?.categories },
    { label: "Herramientas de lectura", kind: "list", get: (c) => c.tools?.read },
    { label: "Herramientas de acción", kind: "list", get: (c) => c.tools?.write },
    { label: "Las acciones piden confirmación", kind: "scalar", get: (c) => c.permissions?.writesRequireConfirmation, show: yesNo },
  ] },
];

const isEmpty = (v: Scalar) => v === undefined || v === null || (typeof v === "string" && v.trim() === "");
const text = (f: ScalarField, v: Scalar) => (f.show ? f.show(v) : isEmpty(v) ? "" : String(v));

function compareField(f: FieldSpec, from: Partial<AgentConfig>, to: Partial<AgentConfig>): FieldChange | null {
  if (f.kind === "scalar") {
    const a = f.get(from), b = f.get(to);
    const ea = isEmpty(a), eb = isEmpty(b);
    if (ea && eb) return null;
    if (!ea && !eb && a === b) return null;
    const kind: ChangeKind = ea ? "added" : eb ? "removed" : "modified";
    return { label: f.label, kind, before: ea ? null : text(f, a), after: eb ? null : text(f, b), addedItems: [], removedItems: [] };
  }
  const a = f.get(from) ?? [], b = f.get(to) ?? [];
  const removedItems = a.filter((x) => !b.includes(x));
  const addedItems = b.filter((x) => !a.includes(x));
  if (addedItems.length === 0 && removedItems.length === 0) {
    if (a.length === b.length && a.some((x, i) => x !== b[i])) {
      return { label: f.label, kind: "reordered", before: a.join(", "), after: b.join(", "), addedItems, removedItems };
    }
    return null;
  }
  const kind: ChangeKind = a.length === 0 ? "added" : b.length === 0 ? "removed" : "modified";
  return { label: f.label, kind, before: null, after: null, addedItems, removedItems };
}

/** Cambios de `from` (base) a `to` (nueva), agrupados por sección. Todas las secciones salen, con o sin cambios. */
export function diffVersions(from: Cfg, to: Cfg): SectionDiff[] {
  const a = from ?? {}, b = to ?? {};
  return SPEC.map((s) => ({
    id: s.id,
    title: s.title,
    changes: s.fields.map((f) => compareField(f, a, b)).filter((c): c is FieldChange => c !== null),
  }));
}

export const countChanges = (diff: SectionDiff[]) => diff.reduce((n, s) => n + s.changes.length, 0);
