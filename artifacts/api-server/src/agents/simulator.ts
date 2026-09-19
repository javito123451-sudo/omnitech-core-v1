// ═══════════════════════════════════════════════════════════════════════════
//  Agent simulator — SIMULATION mode.
//
//  Shows what an agent WOULD do for a message without doing any of it:
//  no AI provider call, no credits, no tool execution, no messages, no
//  records. It is a pure function over an already-loaded agent + config: it
//  imports neither the AI Gateway nor the database, so it cannot spend or
//  write anything even by mistake.
//
//  The reply is a deterministic template, not a model answer — enough to
//  design and debug a configuration (which tools it would reach for, which
//  action it would propose, what a real run would cost) before paying for
//  real AI. Tools are matched by keyword, which is a rough stand-in for the
//  model's own choice.
// ═══════════════════════════════════════════════════════════════════════════

import type { AgentConfig } from "@workspace/db";
import type { RoutingContext } from "../ai-gateway/providerRouter";
import { estimateRunCost } from "./runEstimate";
import type { AgentTool } from "./toolRegistry";

export const SIMULATION_SCENARIOS = [
  { id: "new_client",  label: "Cliente nuevo",       message: "Hola, es la primera vez que os escribo. ¿Qué servicios ofrecéis?" },
  { id: "angry",       label: "Cliente enfadado",    message: "Estoy muy molesto, llevo días esperando y nadie me contesta. Quiero hablar con una persona." },
  { id: "undecided",   label: "Cliente indeciso",    message: "No sé si contratar o esperar un poco, ¿qué me recomiendas?" },
  { id: "asks_price",  label: "Pregunta el precio",  message: "¿Cuánto cuesta? Necesito un presupuesto." },
  { id: "wants_appt",  label: "Quiere una cita",     message: "Me gustaría agendar una cita para esta semana." },
  { id: "cancels",     label: "Cancela",             message: "Necesito cancelar la cita que tengo." },
  { id: "returning",   label: "Cliente recurrente",  message: "Hola otra vez, soy cliente vuestro desde hace tiempo. ¿Podéis recordarme mis citas?" },
  { id: "asks_info",   label: "Pide información",    message: "¿Cuál es vuestro horario y dónde estáis?" },
] as const;

export interface SimulationInput {
  agent:         { id: number; name: string; description?: string | null };
  versionNumber: number | null;
  config:        AgentConfig;
  message:       string;
  /** Tools this user could actually give the agent (already authorized). */
  readTools:     AgentTool[];
  actionTools:   AgentTool[];
  knowledge?:    string;
  routing?:      Pick<RoutingContext, "plan" | "workspace">;
}

export interface SimulationResult {
  simulated:    true;
  agent:        { id: number; name: string; versionNumber: number | null };
  route:        { provider: string; model: string };
  toolsSelected: string[];
  proposedAction: { toolId: string; params: Record<string, unknown>; requiresConfirmation: true } | null;
  /** Tokens estimados (no reales): entrada, salida típica y tope de salida. */
  tokensEstimated: { input: number; outputTypical: number; outputMax: number };
  estimate: { typicalCostUsd: number; typicalCredits: number; maxCostUsd: number; maxCredits: number; priceKnown: boolean; priceSource: "db" | "legacy" | "fallback" };
  reply:        string;
  notes:        string[];
}

function matches(message: string, tool: AgentTool): boolean {
  const text = message.toLowerCase();
  return tool.keywords.some((k) => text.includes(k.toLowerCase()));
}

export function simulateAgent(input: SimulationInput): SimulationResult {
  const { agent, config, message } = input;
  const toolsSelected = [
    ...input.readTools.filter((t) => matches(message, t)),
    ...input.actionTools.filter((t) => matches(message, t)),
  ];
  const action = toolsSelected.find((t) => t.kind === "action");
  const proposedAction = action
    ? {
        toolId: action.id,
        params: action.id === "create_task" ? { title: message.trim().slice(0, 80) } : {},
        requiresConfirmation: true as const,
      }
    : null;

  const est = estimateRunCost({
    agent, config, message, knowledge: input.knowledge, routing: input.routing,
    toolIds: [...input.readTools, ...input.actionTools].map((t) => t.id),
  });
  const route = est.route;

  const readNames = toolsSelected.filter((t) => t.kind === "read").map((t) => t.id);
  const reply = proposedAction
    ? `[SIMULACIÓN] Voy a usar «${proposedAction.toolId}». ¿Confirmas que lo haga? (no se ejecuta nada en una simulación)`
    : readNames.length
      ? `[SIMULACIÓN] Consultaría ${readNames.join(", ")} para responder a: «${message.trim().slice(0, 80)}».`
      : `[SIMULACIÓN] ${agent.name} respondería con sus instrucciones y su conocimiento, sin usar herramientas (tono: ${config.personality.tone}).`;

  const notes = ["Simulación: no se ha llamado a ningún proveedor de IA, no se han consumido créditos y no se ha ejecutado ninguna acción."];
  if (!est.priceKnown) notes.push(`No hay precio registrado para ${route.provider}/${route.model}; el coste usa una tarifa de referencia.`);
  if (config.tools.read.length + config.tools.write.length > input.readTools.length + input.actionTools.length) {
    notes.push("Algunas herramientas configuradas no están disponibles para este usuario o workspace y se han excluido.");
  }

  return {
    simulated: true,
    agent: { id: agent.id, name: agent.name, versionNumber: input.versionNumber },
    route,
    toolsSelected: toolsSelected.map((t) => t.id),
    proposedAction,
    tokensEstimated: est.tokens,
    estimate: {
      typicalCostUsd: est.typical.costUsd, typicalCredits: est.typical.credits,
      maxCostUsd: est.max.costUsd, maxCredits: est.max.credits, priceKnown: est.priceKnown, priceSource: est.priceSource,
    },
    reply,
    notes,
  };
}
