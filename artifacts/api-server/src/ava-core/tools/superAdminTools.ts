// ═══════════════════════════════════════════════════════════════════════════
//  AVA CORE — Ava Super Admin tool catalog (READ ONLY)
//  Every tool here calls the exact same query logic Control Center / AI
//  Center already use — extracted to named functions in those route files
//  specifically so Ava could reuse them in-process instead of duplicating
//  the queries or self-calling the HTTP endpoints.
// ═══════════════════════════════════════════════════════════════════════════

import type { AvaTool } from "../types";
import {
  getHealthData, getMetricsData, getWorkspacesData, getUsersData,
  getModulesData, getLicensesData, getAuditLogsData, getIntegrationsData,
  getSecuritySummaryData,
} from "../../routes/control-center";
import { getAiStatsData, getFinancialData } from "../../routes/ai-center-routes";

function tool(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  execute: AvaTool["execute"],
  required: string[] = [],
): AvaTool {
  return {
    definition: {
      type: "function",
      function: { name, description, parameters: { type: "object", properties, required } },
    },
    execute,
  };
}

export const SUPER_ADMIN_TOOLS: AvaTool[] = [
  tool("get_system_health", "Estado de salud del sistema: base de datos, OpenAI, WhatsApp, Clerk, memoria.", {}, async () => getHealthData()),

  tool("get_platform_metrics", "Métricas globales de la plataforma: workspaces, usuarios, clientes, mensajes, presupuestos.", {}, async () => getMetricsData()),

  tool("get_workspaces", "Lista todos los workspaces/organizaciones con su plan, estado y conteo de usuarios/clientes.", {}, async () => getWorkspacesData()),

  tool("get_users", "Lista todos los usuarios de la plataforma con sus workspaces, roles y rol de plataforma.", {}, async () => getUsersData()),

  tool("get_modules", "Catálogo de módulos y qué workspaces los tienen activados.", {}, async () => getModulesData()),

  tool("get_licenses", "Planes de licencia asignados a cada workspace.", {}, async () => getLicensesData()),

  tool("get_audit_logs", "Consulta el log de auditoría de la plataforma con filtros opcionales.", {
    severity: { type: "string", description: "info, warning, critical" },
    action:   { type: "string", description: "Filtro de texto sobre el nombre de la acción" },
    orgId:    { type: "string", description: "ID de organización" },
    limit:    { type: "number", description: "Máximo de resultados (por defecto 50, máx 200)" },
  }, async (args) => getAuditLogsData(args as any)),

  tool("get_integrations", "Estado de las integraciones globales: WhatsApp, Telegram, email, Stripe, OpenAI, cifrado.", {}, async () => getIntegrationsData()),

  tool("get_security_summary", "Resumen de seguridad: eventos críticos/warning, usuarios/orgs suspendidos, vulnerabilidades conocidas.", {}, async () => getSecuritySummaryData()),

  tool("get_ai_usage", "Estadísticas de uso de IA: llamadas, tokens, coste, desglose por modelo (mes actual y total).", {}, async () => getAiStatsData()),

  tool("get_billing_stats", "Ingresos por plan vs. coste de IA por workspace, con margen.", {}, async () => getFinancialData()),
];
