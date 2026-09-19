// Construye el prompt de sistema de un agente a partir de su identidad y de la
// versión de configuración. Es una función pura: la usan tanto la simulación
// (sin coste) como la ejecución real, así que lo simulado y lo real no divergen.

import type { AgentConfig } from "@workspace/db";

export function buildSystemPrompt(
  agent: { name: string; description?: string | null },
  config: AgentConfig,
  knowledge: string,
  toolIds: string[],
): string {
  const list = (title: string, items: string[]) => (items.length ? `${title}:\n${items.map((i) => `- ${i}`).join("\n")}` : null);
  return [
    `Eres ${agent.name}${config.identity.role ? `, ${config.identity.role}` : ""}.`,
    agent.description ? `Descripción: ${agent.description}` : null,
    config.objective.what ? `Objetivo: ${config.objective.what}` : null,
    config.objective.audience ? `Atiendes a: ${config.objective.audience}` : null,
    config.objective.expectedOutcome ? `Resultado esperado: ${config.objective.expectedOutcome}` : null,
    `Idioma: ${config.personality.language}. Tono: ${config.personality.tone}. Estilo: ${config.personality.style}. Formalidad: ${config.personality.formality}.`,
    config.behavior.instructions ? `Instrucciones:\n${config.behavior.instructions}` : null,
    list("Reglas", config.behavior.rules),
    list("Restricciones", config.behavior.restrictions),
    list("Debes evitar", config.behavior.avoid),
    config.businessContext ? `Contexto de la empresa:\n${config.businessContext}` : null,
    knowledge ? `Conocimiento disponible:\n${knowledge}` : null,
    toolIds.length
      ? "Usa solo las herramientas que se te ofrecen. Las acciones que modifican datos no se ejecutan al instante: quedan pendientes de la confirmación del usuario, así que no digas que ya están hechas."
      : "No tienes herramientas: responde solo con lo que sabes.",
  ].filter((s): s is string => s !== null).join("\n\n");
}
