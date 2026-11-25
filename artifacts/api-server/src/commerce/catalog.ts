/**
 * Catálogo comercial. Los PRECIOS de planes son los confirmados por el propietario
 * (25-nov-2026): Starter 149 € (promo lanzamiento 99 €, desactivada por defecto),
 * Professional 249 €, Enterprise 1.000 € · mensual · sin IVA.
 *
 * Los módulos individuales NO tienen precio definido: se siembran con precio NULL,
 * billing_mode 'quote' y sellable=false. No se inventan precios.
 * Los slugs coinciden con los del Control Center (control-center.ts CATALOG).
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export const PLAN_PRODUCTS = [
  { code: "plan_starter",      plan: "starter",      name: "Omnitech-Core Starter",      list: 14900,  promo: 9900 as number | null },
  { code: "plan_professional", plan: "professional", name: "Omnitech-Core Professional", list: 24900,  promo: null },
  { code: "plan_enterprise",   plan: "enterprise",   name: "Omnitech-Core Enterprise",   list: 100000, promo: null },
] as const;

export const MODULE_PRODUCTS: ReadonlyArray<{ slug: string; name: string; description: string }> = [
  { slug: "crm", name: "Omni CRM", description: "Gestión de clientes y relaciones" },
  { slug: "ai_agents", name: "AI Agents", description: "Agentes de IA personalizados" },
  { slug: "omni_agent_factory", name: "Omni Agent Factory", description: "Crea, versiona y publica agentes de IA" },
  { slug: "analytics", name: "Analytics", description: "Análisis avanzado de datos" },
  { slug: "whatsapp", name: "WhatsApp Business", description: "Mensajería y automatizaciones" },
  { slug: "integrations", name: "Integraciones", description: "Conectores y webhooks externos" },
  { slug: "omni_import_ai", name: "Omni Import AI", description: "Importación inteligente de datos" },
  { slug: "omni_docs", name: "Omni Docs", description: "Gestión documental" },
  { slug: "omni_security", name: "Omni Security Core", description: "Seguridad y auditoría avanzada" },
  { slug: "omni_marketing", name: "Omni Marketing Hub", description: "Campañas y automatización de marketing" },
  { slug: "automations", name: "Automations", description: "Flujos de trabajo automatizados" },
  { slug: "omni_accounting", name: "Omni Accounting", description: "Facturación, pagos y contabilidad" },
  { slug: "omni_diagnostics", name: "Omni Diagnostics", description: "Diagnóstico y salud del sistema" },
  { slug: "omni_tax", name: "OmniTax", description: "Motor fiscal, calendario y simuladores" },
  { slug: "omni_ads", name: "OmniAds", description: "Centro de publicidad con IA" },
  { slug: "omni_leads", name: "OmniLeads AI", description: "Captación y gestión de leads con IA" },
  { slug: "omni_seller", name: "OmniSeller", description: "Orquestación de campañas de prospección B2B" },
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
    await db.execute(sql`
      INSERT INTO commerce_products (code, kind, name, description, module_slugs, billing_mode, sellable)
      VALUES (${"module_" + m.slug}, 'module', ${m.name}, ${m.description}, ${JSON.stringify([m.slug])}::jsonb, 'quote', FALSE)
      ON CONFLICT (code) DO NOTHING`);
  }
}
