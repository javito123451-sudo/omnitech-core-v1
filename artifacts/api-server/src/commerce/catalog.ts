/**
 * Catálogo comercial. Los PRECIOS de planes son los confirmados por el propietario
 * (25-nov-2026): Starter 149 € (promo lanzamiento 99 €, desactivada por defecto),
 * Professional 249 €, Enterprise 1.000 € · mensual · sin IVA.
 *
 * Módulos (complementos mensuales, sin IVA; decisión del propietario 25-nov-2026). NO se venden
 * sueltos en la tienda (sellable=false): el administrador los incorpora según necesidades.
 *   - sin IA relevante : 25 €     - IA ligera (gpt-4o-mini) : 35 €     - IA pesada (gpt-4o) : 45 €
 * `crm` va incluido en todos los planes: sin precio de complemento.
 * Los slugs coinciden con los del Control Center (control-center.ts CATALOG).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * DECISIÓN (25-nov-2026): el plan `business` NO se comercializa. En el código da acceso a TODOS los módulos
 * (igual que enterprise), así que a 699 € canibalizaría a Enterprise (1.000 €). Sigue existiendo en BD
 * (credit_plans / organizations.plan) solo como plan heredado para empresas que ya lo tengan: no se toca ni se borra.
 * Autorizar o activar un plan fuera de PLAN_PRODUCTS se rechaza (ver capture.ts y activation.ts).
 */
export const PLAN_PRODUCTS = [
  { code: "plan_starter",      plan: "starter",      name: "Omnitech-Core Starter",      list: 14900,  promo: 9900 as number | null },
  { code: "plan_professional", plan: "professional", name: "Omnitech-Core Professional", list: 24900,  promo: null },
  { code: "plan_enterprise",   plan: "enterprise",   name: "Omnitech-Core Enterprise",   list: 100000, promo: null },
] as const;

export const MODULE_PRICE_CENTS = { none: 2500, light: 3500, heavy: 4500 } as const;
export type ModuleAiTier = keyof typeof MODULE_PRICE_CENTS;

export const MODULE_PRODUCTS: ReadonlyArray<{ slug: string; name: string; description: string; tier: ModuleAiTier | "included" }> = [
  { slug: "crm", name: "Omni CRM", description: "Gestión de clientes y relaciones", tier: "included" },
  { slug: "ai_agents", name: "AI Agents", description: "Agentes de IA personalizados", tier: "light" },
  { slug: "omni_agent_factory", name: "Omni Agent Factory", description: "Crea, versiona y publica agentes de IA", tier: "light" },
  { slug: "analytics", name: "Analytics", description: "Análisis avanzado de datos", tier: "light" },
  { slug: "whatsapp", name: "WhatsApp Business", description: "Mensajería y automatizaciones", tier: "light" },
  { slug: "integrations", name: "Integraciones", description: "Conectores y webhooks externos", tier: "none" },
  { slug: "omni_import_ai", name: "Omni Import AI", description: "Importación inteligente de datos", tier: "heavy" },
  { slug: "omni_docs", name: "Omni Docs", description: "Gestión documental", tier: "none" },
  { slug: "omni_security", name: "Omni Security Core", description: "Seguridad y auditoría avanzada", tier: "none" },
  { slug: "omni_marketing", name: "Omni Marketing Hub", description: "Campañas y automatización de marketing", tier: "light" },
  { slug: "automations", name: "Automations", description: "Flujos de trabajo automatizados", tier: "light" },
  { slug: "omni_accounting", name: "Omni Accounting", description: "Facturación, pagos y contabilidad", tier: "none" },
  { slug: "omni_diagnostics", name: "Omni Diagnostics", description: "Diagnóstico y salud del sistema", tier: "none" },
  { slug: "omni_tax", name: "OmniTax", description: "Motor fiscal, calendario y simuladores", tier: "none" },
  { slug: "omni_ads", name: "OmniAds", description: "Centro de publicidad con IA", tier: "heavy" },
  { slug: "omni_leads", name: "OmniLeads AI", description: "Captación y gestión de leads con IA", tier: "heavy" },
  { slug: "omni_seller", name: "OmniSeller", description: "Orquestación de campañas de prospección B2B", tier: "heavy" },
];

/** Idempotente: no pisa precios ni promo editados después por el administrador. */
export async function seedCatalog(): Promise<void> {
  for (const p of PLAN_PRODUCTS) {
    await db.execute(sql`
      INSERT INTO commerce_products (code, kind, name, plan, billing_mode, list_price_cents, promo_price_cents, promo_active, sellable)
      VALUES (${p.code}, ${p.plan === "enterprise" ? "enterprise" : "plan"}, ${p.name}, ${p.plan}, 'subscription_monthly', ${p.list}, ${p.promo}, FALSE, TRUE)
      ON CONFLICT (code) DO NOTHING`);
  }
  for (const m of MODULE_PRODUCTS) {
    const price = m.tier === "included" ? null : MODULE_PRICE_CENTS[m.tier];
    // Solo rellena el precio si aún no hay uno: nunca pisa un precio editado por el administrador.
    await db.execute(sql`
      INSERT INTO commerce_products (code, kind, name, description, module_slugs, billing_mode, list_price_cents, sellable)
      VALUES (${"module_" + m.slug}, 'module', ${m.name}, ${m.description}, ${JSON.stringify([m.slug])}::jsonb,
              ${price === null ? "quote" : "subscription_monthly"}, ${price}::int, FALSE)
      ON CONFLICT (code) DO UPDATE SET list_price_cents = EXCLUDED.list_price_cents, billing_mode = EXCLUDED.billing_mode, updated_at = NOW()
       WHERE commerce_products.list_price_cents IS NULL AND EXCLUDED.list_price_cents IS NOT NULL`);
  }
}
