/**
 * Plan Chooser — mapeo de experiencia inicial (Empresa / Persona / A3) a
 * módulos y plan recomendado.
 *
 * No escribe nada en la base de datos. Lo usa únicamente la pantalla de
 * /setup para calcular la ficha de resultado y el texto de alta manual que
 * se le pasa al SUPER_ADMIN — la creación real de la organización sigue
 * haciéndose a mano en /control-center/onboard-wizard, como hoy.
 */

export type ExperienceType = "business" | "personal" | "a3";
export type PersonaNeed = "home" | "learn" | "wellness";
export type A3ServiceType = "organization" | "cleaning";
export type A3ClientSegment = "individual" | "professional";

export interface ModuleRef {
  /** module_slug tal y como se guardaría en module_configs */
  slug: string;
  label: string;
  /**
   * true si el módulo todavía NO existe en el catálogo real del backend
   * (ALL_MODULE_SLUGS en auth.ts / MODULE_CATALOG_SLUGS en control-center.ts).
   * Verificado a mano contra el repo el 2026-10-20 — si se añaden módulos
   * nuevos al catálogo, actualizar esta lista.
   */
  isNew: boolean;
}

// ── Empresa: rama cerrada, siempre resuelve a la plantilla "servicios" ─────
// (coincide con la fila real de onboard_templates: slug "servicios",
// recommended_plan "growth")
export const BUSINESS_TEMPLATE_SLUG = "servicios";
export const BUSINESS_RECOMMENDED_PLAN = "growth";
export const BUSINESS_MODULES: ModuleRef[] = [
  { slug: "crm",             label: "CRM",             isNew: false },
  { slug: "quotes",          label: "Presupuestos",    isNew: false },
  { slug: "omni_accounting", label: "Contabilidad",    isNew: false },
  { slug: "omni_tax",        label: "Impuestos",       isNew: false },
  { slug: "automations",     label: "Automatizaciones", isNew: false },
];

// ── Persona: mapeo atómico necesidad → módulo (todos nuevos, aún no existen
// en el catálogo real) ──────────────────────────────────────────────────
export const PERSONA_NEED_MODULES: Record<PersonaNeed, ModuleRef> = {
  home:      { slug: "personal_home",      label: "Hogar",      isNew: true },
  learn:     { slug: "personal_learn",     label: "Aprender",   isNew: true },
  wellness:  { slug: "personal_wellness",  label: "Bienestar",  isNew: true },
};
export const PERSONA_RECOMMENDED_PLAN = "starter";

// ── A3: mapeo atómico servicio → módulo (también nuevos) ───────────────────
export const A3_SERVICE_MODULES: Record<A3ServiceType, ModuleRef> = {
  organization: { slug: "a3_organization", label: "Ordenación de espacios",   isNew: true },
  cleaning:     { slug: "a3_cleaning",      label: "Limpieza profesional",     isNew: true },
};
export const A3_RECOMMENDED_PLAN = "starter";

export const A3_SEGMENT_LABELS: Record<A3ClientSegment, string> = {
  individual:   "Particular",
  professional: "Profesional",
};

export interface ChooserSelection {
  clientName: string;
  experienceType: ExperienceType;
  personaNeeds: PersonaNeed[];
  a3ServiceTypes: A3ServiceType[];
  a3ClientSegment: A3ClientSegment | null;
}

export interface ChooserResult {
  branchLabel: string;
  modules: ModuleRef[];
  recommendedPlan: string;
  templateSlug: string | null;
  hasNewModules: boolean;
  instructions: string;
}

export function resolveChooserSelection(sel: ChooserSelection): ChooserResult {
  if (sel.experienceType === "business") {
    const modules = BUSINESS_MODULES;
    return {
      branchLabel: "Empresa",
      modules,
      recommendedPlan: BUSINESS_RECOMMENDED_PLAN,
      templateSlug: BUSINESS_TEMPLATE_SLUG,
      hasNewModules: false,
      instructions: buildInstructions(sel, "Empresa", modules, BUSINESS_RECOMMENDED_PLAN, BUSINESS_TEMPLATE_SLUG),
    };
  }

  if (sel.experienceType === "personal") {
    const modules = sel.personaNeeds.map((n) => PERSONA_NEED_MODULES[n]);
    const branchLabel = `Persona (${sel.personaNeeds.map((n) => PERSONA_NEED_MODULES[n].label).join(", ")})`;
    return {
      branchLabel,
      modules,
      recommendedPlan: PERSONA_RECOMMENDED_PLAN,
      templateSlug: null,
      hasNewModules: modules.some((m) => m.isNew),
      instructions: buildInstructions(sel, branchLabel, modules, PERSONA_RECOMMENDED_PLAN, null),
    };
  }

  // a3
  const modules = sel.a3ServiceTypes.map((s) => A3_SERVICE_MODULES[s]);
  const segmentLabel = sel.a3ClientSegment ? A3_SEGMENT_LABELS[sel.a3ClientSegment] : "sin especificar";
  const branchLabel = `A3 — ${sel.a3ServiceTypes.map((s) => A3_SERVICE_MODULES[s].label).join(", ")} (${segmentLabel})`;
  return {
    branchLabel,
    modules,
    recommendedPlan: A3_RECOMMENDED_PLAN,
    templateSlug: null,
    hasNewModules: modules.some((m) => m.isNew),
    instructions: buildInstructions(sel, branchLabel, modules, A3_RECOMMENDED_PLAN, null, segmentLabel),
  };
}

function buildInstructions(
  sel: ChooserSelection,
  branchLabel: string,
  modules: ModuleRef[],
  recommendedPlan: string,
  templateSlug: string | null,
  segmentLabel?: string,
): string {
  const lines: string[] = [];
  lines.push(`ALTA MANUAL — ${sel.clientName || "(sin nombre)"}`);
  lines.push(`Experiencia: ${branchLabel}`);
  if (segmentLabel) lines.push(`Segmento de cliente: ${segmentLabel} (solo metadato, no activa módulos)`);
  lines.push("");
  lines.push("1) Control Center → Onboard Wizard → Crear workspace");
  lines.push(`   Nombre: ${sel.clientName || "(pendiente)"}`);
  if (templateSlug) {
    lines.push(`   Plantilla: ${templateSlug}`);
  } else {
    lines.push(`   Plantilla: (ninguna — selección fuera de catálogo de Empresa, no usar las 11 verticales)`);
  }
  lines.push(`   Plan: ${recommendedPlan}`);
  lines.push(`   Módulos a marcar: ${modules.filter((m) => !m.isNew).map((m) => m.label).join(", ") || "(ninguno existente)"}`);

  const newModules = modules.filter((m) => m.isNew);
  if (newModules.length > 0) {
    lines.push("");
    lines.push("2) Módulos NUEVOS — todavía no existen en el catálogo, no aparecerán como casilla en el wizard:");
    for (const m of newModules) {
      lines.push(`   - ${m.label}  (module_slug: "${m.slug}")`);
    }
    lines.push("   Hasta que se construyan sus páginas/guard, activar a mano insertando en module_configs:");
    lines.push(`   is_enabled = true, module_slug = uno de los de arriba, org_id = el de la organización recién creada.`);
  }

  return lines.join("\n");
}
