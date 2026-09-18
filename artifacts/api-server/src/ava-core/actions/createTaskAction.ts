// ═══════════════════════════════════════════════════════════════════════════
//  AVA CORE — create_task (pilot action)
//
//  READ → PROPOSE → CONFIRM → EXECUTE → AUDIT, using the create_task skill
//  that already exists in the Skill Engine (skills/taskSkills.ts) — Ava does
//  not reimplement task creation, it only adds the propose/confirm gate in
//  front of the existing, already-org-scoped skill.
// ═══════════════════════════════════════════════════════════════════════════

import { executeSkill } from "../../skills";
import { getPermissionsForRole } from "../../middlewares/permissions";
import type { AvaAction, AvaContext } from "../types";

function requireCrmWrite(ctx: AvaContext) {
  // Platform SUPER_ADMIN can act on any workspace via Ava (same bypass the
  // rest of the app grants); otherwise the real workspace role must carry
  // crm.write. read_only / vendedor-without-write etc. are rejected here,
  // in the action layer — not left to the model's good behavior.
  if (ctx.platformRole === "SUPER_ADMIN") return;
  const perms = getPermissionsForRole(ctx.orgRole);
  if (!perms.has("crm.write")) {
    throw new Error("No tienes permiso para crear tareas (se requiere crm.write).");
  }
}

export const createTaskAction: AvaAction = {
  id: "create_task",
  requiredPermission: "crm.write",

  async propose(rawParams, ctx) {
    requireCrmWrite(ctx);

    const title = String(rawParams["title"] ?? "").trim();
    if (!title) throw new Error("Falta el título de la tarea.");

    const params: Record<string, unknown> = {
      title,
      description: rawParams["description"] ?? undefined,
      priority:    rawParams["priority"] ?? "medium",
      due_date:    rawParams["due_date"] ?? undefined,
      client_name: rawParams["client_name"] ?? undefined,
      assigned_to: rawParams["assigned_to"] ?? undefined,
    };

    const lines = [
      "Voy a crear esta tarea:",
      "",
      `Título: ${title}`,
      params["due_date"] ? `Fecha: ${params["due_date"]}` : null,
      params["assigned_to"] ? `Asignada a: ${params["assigned_to"]}` : null,
      params["client_name"] ? `Cliente: ${params["client_name"]}` : null,
      "",
      "¿Quieres que la cree?",
    ].filter((l): l is string => l !== null);

    return { summary: lines.join("\n"), params };
  },

  async execute(params, ctx) {
    requireCrmWrite(ctx);
    const result = await executeSkill("create_task", params, ctx.orgId, {
      channel: "internal",
      user: { id: ctx.clerkUserId, name: ctx.clerkUserId },
      meta: { source: "ava_core_action_pilot" },
    });
    if (!result.success) throw new Error(result.error ?? "No se pudo crear la tarea.");
    return JSON.parse(result.result);
  },
};

export const AVA_ACTIONS: Record<string, AvaAction> = {
  create_task: createTaskAction,
};
