// ═══════════════════════════════════════════════════════════════════════════
//  Agent Tool Registry — the central catalog of what an agent may be given.
//
//  It sits on top of the Skill Engine (which owns HOW a tool runs) and adds
//  what the Factory needs to govern it: whether it only READS or ACTS
//  (modifies data / contacts someone), the real RBAC permission a user must
//  hold, and the workspace module that must be enabled. An agent never gets a
//  tool just because it exists: it must be listed by the agent's version AND
//  the user must hold the permission AND the module must be on.
//
//  A skill missing from this registry is unusable by agents (default deny);
//  a test fails if a skill is added without registering it here.
// ═══════════════════════════════════════════════════════════════════════════

import type { Permission } from "../middlewares/permissions";

export type ToolKind = "read" | "action";

export interface AgentTool {
  id:         string;
  kind:       ToolKind;
  /** Real RBAC permission the acting user must hold. */
  permission: Permission;
  /** Workspace module that must be enabled (module_configs). */
  module:     string;
  /** Spanish trigger phrases; only used by the free simulator to pick tools. */
  keywords:   string[];
}

const tool = (id: string, kind: ToolKind, permission: Permission, module: string, keywords: string[]): AgentTool =>
  ({ id, kind, permission, module, keywords });

export const TOOL_REGISTRY: AgentTool[] = [
  // Citas y calendario
  tool("get_appointments",       "read",   "calendar.read",  "crm", ["mis citas", "agenda", "próxima cita", "citas"]),
  tool("create_appointment",     "action", "calendar.write", "crm", ["agendar", "reservar", "pedir cita", "quedar"]),
  tool("reschedule_appointment", "action", "calendar.write", "crm", ["reprogramar", "cambiar la cita", "mover la cita"]),
  tool("cancel_appointment",     "action", "calendar.write", "crm", ["cancelar la cita", "anular la cita", "cancelar"]),
  // Clientes
  tool("list_clients",           "read",   "crm.read",       "crm", ["clientes", "lista de clientes"]),
  tool("get_client",             "read",   "crm.read",       "crm", ["ficha", "datos del cliente", "cliente"]),
  tool("create_client",          "action", "crm.write",      "crm", ["nuevo cliente", "dar de alta", "registrar cliente"]),
  // Presupuestos
  tool("list_quotes",            "read",   "quotes.read",    "crm", ["presupuestos", "ver presupuesto"]),
  tool("create_quote",           "action", "quotes.write",   "crm", ["crear presupuesto", "hacer un presupuesto", "cotización"]),
  // Contabilidad
  tool("get_invoice",            "read",   "accounting.read",  "omni_accounting", ["ver factura", "factura número"]),
  tool("list_pending_invoices",  "read",   "accounting.read",  "omni_accounting", ["facturas pendientes", "pendientes de cobro"]),
  tool("get_client_debt",        "read",   "accounting.read",  "omni_accounting", ["deuda", "cuánto debe"]),
  tool("get_monthly_income",     "read",   "accounting.read",  "omni_accounting", ["ingresos del mes", "cuánto he facturado"]),
  tool("accounting_summary",     "read",   "accounting.read",  "omni_accounting", ["resumen contable", "contabilidad"]),
  tool("create_invoice",         "action", "accounting.write", "omni_accounting", ["crear factura", "facturar"]),
  tool("register_payment",       "action", "accounting.write", "omni_accounting", ["registrar pago", "cobrado", "pago recibido"]),
  // Tareas
  tool("list_tasks",             "read",   "crm.read",       "crm", ["mis tareas", "tareas pendientes"]),
  tool("create_task",            "action", "crm.write",      "crm", ["crear tarea", "tarea", "recordar", "recordatorio", "llamar"]),
  // Comunicación
  tool("escalate_to_human",      "action", "messages.write", "crm", ["hablar con una persona", "agente humano", "escalar", "humano"]),
  // Omni Taller
  tool("get_repair_status",      "read",   "taller.read",    "omni_taller", ["estado de mi coche", "reparación", "vehículo"]),
  tool("create_repair_order",    "action", "taller.write",   "omni_taller", ["abrir orden", "nueva reparación"]),
  tool("update_repair_stage",    "action", "taller.write",   "omni_taller", ["cambiar la fase", "actualizar la reparación"]),
];

const BY_ID = new Map(TOOL_REGISTRY.map((t) => [t.id, t]));

export const getAgentTool = (id: string): AgentTool | undefined => BY_ID.get(id);
export const listAgentTools = (): AgentTool[] => TOOL_REGISTRY;
