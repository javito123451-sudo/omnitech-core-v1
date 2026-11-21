// Fuente única del mapeo plan → módulos permitidos.
// Antes vivía inline en routes/auth.ts (/auth/me); lo reutiliza OmniCommerce al
// activar una licencia aprobada. Cambiar un plan aquí lo cambia en ambos sitios.

export const ALL_MODULE_SLUGS = [
  "crm", "ai_agents", "omni_agent_factory", "analytics", "integrations", "automations",
  "omni_accounting", "omni_import_ai", "whatsapp", "omni_tax",
  "omni_marketing", "omni_ads", "omni_leads", "omni_seller", "omni_diagnostics",
  "omni_security", "omni_docs", "quotes", "portal_cliente",
  "knowledge_base", "a_medida", "omni_fleet", "omni_taller",
] as const;

// Cada plan define qué slugs están PERMITIDOS. module_configs solo puede
// restringir dentro del plan; no puede conceder más allá del límite del plan.
export const PLAN_MODULES: Record<string, readonly string[]> = {
  // ── Planes actuales ───────────────────────────────────────────────────────
  starter:         ["crm", "whatsapp", "omni_marketing", "knowledge_base",
                    "omni_accounting", "ai_agents", "omni_agent_factory", "quotes", "portal_cliente"],
  professional:    ["crm", "whatsapp", "omni_marketing", "knowledge_base",
                    "omni_accounting", "ai_agents", "omni_agent_factory", "quotes", "portal_cliente",
                    "automations", "integrations", "analytics", "omni_docs"],
  business:        ALL_MODULE_SLUGS,
  enterprise:      ALL_MODULE_SLUGS,
  enterprise_plus: ALL_MODULE_SLUGS,
  // ── Nombres heredados (compatibilidad) ────────────────────────────────────
  free:            ["crm"],
  growth:          ["crm", "ai_agents", "omni_agent_factory", "analytics", "integrations", "automations", "omni_marketing"],
  scale:           ALL_MODULE_SLUGS,
};

/** Planes que se pueden contratar por un canal comercial (Shopify/Hotmart). */
export const SELLABLE_PLANS = ["starter", "professional", "business"] as const;

export function modulesForPlan(plan: string): readonly string[] {
  return PLAN_MODULES[plan] ?? [];
}
