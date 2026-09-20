// ═══════════════════════════════════════════════════════════════════════════
//  Effective authorization for an agent run
//
//  Agent permission + user permission + workspace + tool = what may run.
//  This does NOT replace RBAC, it reuses it: the user's real workspace role
//  decides via getPermissionsForRole(), the workspace decides via the module
//  gate, and the agent version can only NARROW the result (it lists the tools
//  it wants; it can never add one the user or workspace doesn't allow). An
//  agent therefore can't escalate privileges.
//
//  Runs in the backend on every run and every confirmation — never trusted
//  from the prompt, the model, or the client.
//
//  UNA sola implementación de las reglas: evaluateDeclaredTools decide cada
//  herramienta declarada y devuelve el MOTIVO como código. resolveToolAccess
//  (runtime) y resolveEffectiveToolAccess (vista previa de solo lectura) son dos
//  proyecciones de esas mismas decisiones; no hay una segunda copia del RBAC.
// ═══════════════════════════════════════════════════════════════════════════

import type { AgentConfig } from "@workspace/db";
import { getPermissionsForRole } from "../middlewares/permissions";
import { isModuleEnabled } from "../middlewares/requireModule";
import { getAgentTool, listAgentTools, type AgentTool } from "./toolRegistry";

export interface AuthorizationInput {
  config:       Pick<AgentConfig, "tools">;
  orgId:        number;
  orgRole:      string;
  platformRole: string | null;
  /** Injectable for tests. */
  moduleEnabled?: (orgId: number, slug: string) => Promise<boolean>;
}

export interface ToolAccess {
  read:   AgentTool[];
  action: AgentTool[];
  denied: { toolId: string; reason: string }[];
}

// ── Decisión por herramienta (fuente única de las reglas) ─────────────────────

export type ToolDecisionReason =
  | "allowed" | "missing_permission" | "module_disabled" | "unknown_tool" | "duplicate_declaration" | "kind_mismatch";

interface ToolDecision {
  toolId: string;
  /** Lista de la configuración en la que se declaró. */
  bucket: "read" | "action";
  tool:   AgentTool | undefined;
  reason: ToolDecisionReason;
  /** Texto de la denegación (el mismo que ve el runtime); null si se permite. */
  message: string | null;
}

async function evaluateDeclaredTools(input: AuthorizationInput): Promise<ToolDecision[]> {
  const perms = getPermissionsForRole(input.orgRole);
  const bypass = input.platformRole === "SUPER_ADMIN"; // same rule createTaskAction / hasPermission apply
  const moduleEnabled = input.moduleEnabled ?? isModuleEnabled;

  const declared: Array<[string, "read" | "action"]> = [
    ...input.config.tools.read.map((id): [string, "read"] => [id, "read"]),
    ...input.config.tools.write.map((id): [string, "action"] => [id, "action"]),
  ];

  const out: ToolDecision[] = [];
  const seen = new Set<string>();
  for (const [id, bucket] of declared) {
    const deny = (tool: AgentTool | undefined, reason: ToolDecisionReason, message: string) => out.push({ toolId: id, bucket, tool, reason, message });

    if (seen.has(id)) { deny(getAgentTool(id), "duplicate_declaration", "Herramienta declarada dos veces."); continue; }
    seen.add(id);

    const entry = getAgentTool(id);
    if (!entry) { deny(undefined, "unknown_tool", "Herramienta desconocida."); continue; }
    if (entry.kind !== bucket) { deny(entry, "kind_mismatch", `Declarada como '${bucket}' pero es de tipo '${entry.kind}'.`); continue; }
    if (!bypass && !perms.has(entry.permission)) { deny(entry, "missing_permission", `El rol '${input.orgRole}' no tiene el permiso '${entry.permission}'.`); continue; }
    if (!(await moduleEnabled(input.orgId, entry.module))) { deny(entry, "module_disabled", `El módulo '${entry.module}' no está habilitado en este workspace.`); continue; }
    out.push({ toolId: id, bucket, tool: entry, reason: "allowed", message: null });
  }
  return out;
}

/** Runtime: qué herramientas puede usar el agente ahora mismo (declaradas ∩ permiso del usuario ∩ módulo). */
export async function resolveToolAccess(input: AuthorizationInput): Promise<ToolAccess> {
  const access: ToolAccess = { read: [], action: [], denied: [] };
  for (const d of await evaluateDeclaredTools(input)) {
    if (d.reason !== "allowed") { access.denied.push({ toolId: d.toolId, reason: d.message ?? d.reason }); continue; }
    (d.tool!.kind === "read" ? access.read : access.action).push(d.tool!);
  }
  return access;
}

// ── Vista previa del acceso efectivo (solo lectura) ───────────────────────────

export type EffectiveReason = ToolDecisionReason | "confirmation_required" | "not_declared";

export interface EffectiveToolAccess {
  toolId:       string;
  /** Lista de la configuración en la que se declaró (read = «puede leer», write = «puede hacer»); null si no se declaró. */
  declaredAs:   "read" | "write" | null;
  /** Tipo según el registro de herramientas (no según la configuración); null si la herramienta no existe. */
  kind:         AgentTool["kind"] | null;
  permission:   string | null;
  module:       string | null;
  allowed:      boolean;
  reason:       EffectiveReason;
  /** true = si se ejecuta, siempre pasa antes por la confirmación de una persona. */
  requiresConfirmation: boolean;
  message:      string;
}

export interface EffectiveAccessInput extends AuthorizationInput {
  /** También lista las herramientas del registro que el agente NO declara (allowed:false, not_declared). */
  includeUndeclared?: boolean;
}

/**
 * DECLARADAS ∩ RBAC del usuario ∩ módulo ∩ registro = acceso efectivo. No ejecuta nada: solo calcula lo que
 * resolveToolAccess concedería a ESTE usuario con ESTA configuración.
 */
export async function resolveEffectiveToolAccess(input: EffectiveAccessInput): Promise<EffectiveToolAccess[]> {
  const decisions = await evaluateDeclaredTools(input);
  const out: EffectiveToolAccess[] = decisions.map((d) => {
    const allowed = d.reason === "allowed";
    const needsConfirmation = allowed && d.tool!.kind === "action";
    return {
      toolId: d.toolId,
      declaredAs: d.bucket === "read" ? "read" : "write",
      kind: d.tool?.kind ?? null,
      permission: d.tool?.permission ?? null,
      module: d.tool?.module ?? null,
      allowed,
      reason: needsConfirmation ? "confirmation_required" : d.reason,
      requiresConfirmation: needsConfirmation,
      message: allowed
        ? (needsConfirmation ? "Disponible: cada acción necesita la confirmación de una persona." : "Disponible.")
        : (d.message ?? d.reason),
    };
  });

  if (input.includeUndeclared) {
    const declaredIds = new Set(decisions.map((d) => d.toolId));
    for (const t of listAgentTools()) {
      if (declaredIds.has(t.id)) continue;
      out.push({
        toolId: t.id, declaredAs: null, kind: t.kind, permission: t.permission, module: t.module,
        allowed: false, reason: "not_declared", requiresConfirmation: false, message: "El agente no declara esta herramienta.",
      });
    }
  }
  return out;
}
