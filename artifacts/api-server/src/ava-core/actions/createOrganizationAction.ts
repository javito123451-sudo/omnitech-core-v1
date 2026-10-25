// ═══════════════════════════════════════════════════════════════════════════
//  AVA CORE — create_organization (SUPER_ADMIN only)
//
//  READ → PROPOSE → CONFIRM → EXECUTE → AUDIT, igual que create_task.
//  Replica lo esencial de POST /control-center/onboard-wizard/create
//  (organización + licencia + filas de module_configs), SIN crear usuarios
//  ni miembros: al cliente se le une después por invitación por email
//  (Control Center → invitaciones), que es lo que enlaza su login real.
//
//  Solo el rol de plataforma SUPER_ADMIN puede proponerla y ejecutarla —
//  se comprueba en propose() y otra vez en execute().
// ═══════════════════════════════════════════════════════════════════════════

import {
  db, organizationsTable, licensePlansTable, moduleConfigsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { clearModuleCache } from "../../middlewares/requireModule";
import { bumpOrgModuleVersion } from "../../lib/moduleVersion";
import type { AvaAction, AvaContext } from "../types";

// Mismo catálogo que usa el wizard (control-center.ts → MODULE_CATALOG_SLUGS).
const MODULE_CATALOG_SLUGS = [
  "crm", "quotes", "omni_accounting", "omni_tax", "ai_agents", "omni_agent_factory", "automations",
  "analytics", "integrations", "whatsapp", "omni_import_ai", "knowledge_base",
  "portal_cliente", "omni_docs", "omni_ads", "omni_marketing",
] as const;

const VALID_PLANS = ["free", "starter", "professional", "business", "enterprise"] as const;

function requireSuperAdmin(ctx: AvaContext) {
  if (ctx.platformRole !== "SUPER_ADMIN") {
    throw new Error("Solo un SUPER_ADMIN puede crear organizaciones.");
  }
}

function slugify(name: string): string {
  return name
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 50) || "workspace";
}

async function uniqueSlug(base: string): Promise<string> {
  let candidate = base;
  for (let i = 2; i < 50; i++) {
    const [taken] = await db.select({ id: organizationsTable.id })
      .from(organizationsTable).where(eq(organizationsTable.slug, candidate)).limit(1);
    if (!taken) return candidate;
    candidate = `${base}-${i}`;
  }
  throw new Error("No se pudo generar un identificador (slug) libre para el workspace.");
}

export const createOrganizationAction: AvaAction = {
  id: "create_organization",
  contexts: ["super_admin"],

  async propose(rawParams, ctx) {
    requireSuperAdmin(ctx);

    const name = String(rawParams["name"] ?? "").trim();
    if (!name) throw new Error("Falta el nombre del negocio (name).");

    const plan = String(rawParams["plan"] ?? "starter").trim().toLowerCase();
    if (!(VALID_PLANS as readonly string[]).includes(plan)) {
      throw new Error(`Plan no válido: ${plan}. Opciones: ${VALID_PLANS.join(", ")}.`);
    }

    const requested = Array.isArray(rawParams["modules"])
      ? (rawParams["modules"] as unknown[]).map(m => String(m))
      : ["crm"];
    const unknown = requested.filter(m => !(MODULE_CATALOG_SLUGS as readonly string[]).includes(m));
    if (unknown.length > 0) {
      throw new Error(
        `Módulos fuera del catálogo del wizard: ${unknown.join(", ")}. ` +
        `Los módulos nuevos o fuera de catálogo se activan después en Control Center → Módulos.`,
      );
    }
    const modules = Array.from(new Set(["crm", ...requested]));

    const email = rawParams["email"] ? String(rawParams["email"]).trim() : null;
    const phone = rawParams["phone"] ? String(rawParams["phone"]).trim() : null;
    const notes = rawParams["notes"] ? String(rawParams["notes"]).trim() : null;

    const slug = await uniqueSlug(slugify(name));

    const params: Record<string, unknown> = { name, slug, plan, modules, email, phone, notes };

    const lines = [
      "Voy a crear este workspace:",
      "",
      `Nombre: ${name}`,
      `Identificador (slug): ${slug}`,
      `Plan: ${plan}`,
      `Módulos activos: ${modules.join(", ")}`,
      email ? `Email: ${email}` : null,
      phone ? `Teléfono: ${phone}` : null,
      notes ? `Notas: ${notes}` : null,
      "",
      "No crea usuarios: después hay que invitar al cliente por email desde Control Center.",
      "¿Quieres que lo cree?",
    ].filter((l): l is string => l !== null);

    return { summary: lines.join("\n"), params };
  },

  async execute(params, ctx) {
    requireSuperAdmin(ctx);

    const name  = String(params["name"]);
    const plan  = String(params["plan"]);
    const modules = (params["modules"] as string[]) ?? ["crm"];
    // Re-comprobar el slug por si alguien lo ha ocupado entre propuesta y confirmación.
    const slug  = await uniqueSlug(String(params["slug"]));

    const [org] = await db.insert(organizationsTable).values({
      name,
      slug,
      plan,
      email: (params["email"] as string | null) ?? null,
      phone: (params["phone"] as string | null) ?? null,
      country: "ES",
      timezone: "Europe/Madrid",
      language: "es",
      currency: "EUR",
      wizardState: {
        createdByAva: true,
        notes: (params["notes"] as string | null) ?? null,
        createdAt: new Date().toISOString(),
      },
    }).returning();

    const orgId = org!.id;

    await db.insert(licensePlansTable).values({
      orgId, plan, seats: 5, isActive: true,
      assignedBy: ctx.clerkUserId, createdAt: new Date(), updatedAt: new Date(),
    });

    for (const modSlug of MODULE_CATALOG_SLUGS) {
      await db.insert(moduleConfigsTable).values({
        orgId, moduleSlug: modSlug, isEnabled: modules.includes(modSlug),
        config: {}, updatedBy: ctx.clerkUserId,
      }).onConflictDoNothing();
    }

    clearModuleCache(orgId);
    bumpOrgModuleVersion(orgId);

    return { orgId, slug, name, plan, modules };
  },
};
