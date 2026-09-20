// Datos de prueba con la forma real de las respuestas del backend (agentService / simulator).
import type { Agent, AgentConfig, AgentVersion, SimulationResult } from "@/lib/agents/types";

// jsdom no trae ResizeObserver y los Checkbox de Radix dentro de un <form> lo necesitan (en un navegador real existe).
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
}

export const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export const config = (over: Partial<AgentConfig> = {}): AgentConfig => ({
  identity: { role: "Asistente comercial" },
  objective: { what: "Atender consultas de clientes", audience: "Clientes nuevos", expectedOutcome: "Cita agendada" },
  personality: { tone: "cercano", style: "breve", language: "es", formality: "informal" },
  behavior: { instructions: "Responde con amabilidad.", rules: ["Saluda siempre"], restrictions: ["No des precios cerrados"], avoid: ["jerga"] },
  businessContext: "Taller mecánico en Valencia",
  model: {},
  parameters: { temperature: 0.4, maxOutputTokens: 800, maxToolRounds: 3, maxHistoryMessages: 10 },
  knowledge: { workspace: true, entryIds: [], categories: [] },
  tools: { read: [], write: [] },
  permissions: { writesRequireConfirmation: true },
  channels: ["web", "whatsapp"],
  ...over,
});

export const version = (id: number, versionNumber: number, over: Partial<AgentVersion> = {}): AgentVersion => ({
  id, agentId: 7, orgId: 1, versionNumber, config: config(), notes: null,
  publishedAt: null, createdBy: "u", createdAt: "2026-05-01T10:00:00Z", ...over,
});

export const agent = (id: number, name: string, over: Partial<Agent> & { activeVersionNumber?: number | null } = {}) => ({
  id, orgId: 1, name, description: `Descripción de ${name}`, avatarUrl: null, status: "draft" as const, activeVersionId: null,
  limits: {}, monthlyCreditLimit: null, dailyCreditLimit: null, perExecutionCreditLimit: null,
  createdBy: "u", createdAt: "2026-05-01T10:00:00Z", updatedAt: "2026-05-02T10:00:00Z", activeVersionNumber: null, ...over,
});

export const simulation = (over: Partial<SimulationResult> = {}): SimulationResult => ({
  simulated: true,
  agent: { id: 7, name: "Ventas", versionNumber: 2 },
  route: { provider: "openai", model: "gpt-x" },
  toolsSelected: [],
  proposedAction: null,
  estimate: { typicalCredits: 12.5, maxCredits: 80, priceKnown: true, priceSource: "db", provisional: false },
  reply: "[SIMULACIÓN] Ventas respondería con sus instrucciones.",
  notes: ["Simulación: no se ha llamado a ningún proveedor de IA, no se han consumido créditos y no se ha ejecutado ninguna acción."],
  denied: [],
  ...over,
});
