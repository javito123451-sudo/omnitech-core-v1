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
// ═══════════════════════════════════════════════════════════════════════════

import type { AgentConfig } from "@workspace/db";
import { getPermissionsForRole } from "../middlewares/permissions";
import { isModuleEnabled } from "../middlewares/requireModule";
import { getAgentTool, type AgentTool } from "./toolRegistry";

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

export async function resolveToolAccess(input: AuthorizationInput): Promise<ToolAccess> {
  const perms = getPermissionsForRole(input.orgRole);
  const bypass = input.platformRole === "SUPER_ADMIN"; // same rule createTaskAction / hasPermission apply
  const moduleEnabled = input.moduleEnabled ?? isModuleEnabled;

  const access: ToolAccess = { read: [], action: [], denied: [] };
  const declared: Array<[string, "read" | "action"]> = [
    ...input.config.tools.read.map((id): [string, "read"] => [id, "read"]),
    ...input.config.tools.write.map((id): [string, "action"] => [id, "action"]),
  ];

  const seen = new Set<string>();
  for (const [id, bucket] of declared) {
    if (seen.has(id)) { access.denied.push({ toolId: id, reason: "Herramienta declarada dos veces." }); continue; }
    seen.add(id);

    const entry = getAgentTool(id);
    if (!entry) { access.denied.push({ toolId: id, reason: "Herramienta desconocida." }); continue; }
    if (entry.kind !== bucket) {
      access.denied.push({ toolId: id, reason: `Declarada como '${bucket}' pero es de tipo '${entry.kind}'.` });
      continue;
    }
    if (!bypass && !perms.has(entry.permission)) {
      access.denied.push({ toolId: id, reason: `El rol '${input.orgRole}' no tiene el permiso '${entry.permission}'.` });
      continue;
    }
    if (!(await moduleEnabled(input.orgId, entry.module))) {
      access.denied.push({ toolId: id, reason: `El módulo '${entry.module}' no está habilitado en este workspace.` });
      continue;
    }
    (entry.kind === "read" ? access.read : access.action).push(entry);
  }
  return access;
}
