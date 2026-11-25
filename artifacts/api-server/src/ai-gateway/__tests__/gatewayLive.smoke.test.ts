// Prueba REAL (opt-in) del AI Gateway con el proveedor de IA ya configurado en
// el entorno donde se ejecute. Sirve para comprobar, sin crear ningún proveedor
// nuevo, que el camino que usará Omni Review Bot (callAI) está operativo.
//
// No corre por defecto (vitest.config.ts inyecta una OPENAI_API_KEY de relleno,
// por eso la condición NO es "hay clave" sino un opt-in explícito):
//
//   AI_LIVE_SMOKE=1 DATABASE_URL=<rama de pruebas> OPENAI_API_KEY=<la ya existente> \
//     pnpm --filter @workspace/api-server exec vitest run src/ai-gateway/__tests__/gatewayLive.smoke.test.ts
//
// Hace UNA llamada mínima (≤40 tokens de salida), a nivel de plataforma
// (orgId null: no consume presupuesto ni créditos de ningún workspace) y deja
// su fila en ai_usage_logs de la base indicada.
import { describe, it, expect } from "vitest";
import { callAI } from "../gateway";

const live = process.env["AI_LIVE_SMOKE"] === "1";

describe.skipIf(!live)("AI Gateway — llamada real (opt-in)", () => {
  it("genera texto con el proveedor ya configurado y registra el uso", async () => {
    const res = await callAI({
      mode: "live",
      orgId: null,
      functionName: "review_ai_live_smoke",
      usageKind: "ai_content_generation",
      messages: [
        { role: "system", content: "Responde en español, en una sola frase breve." },
        { role: "user", content: "Escribe una frase de agradecimiento a un cliente tras reparar su frigorífico." },
      ],
      options: { maxTokens: 40, temperature: 0.2 },
      maxRetries: 0,
    });
    console.log(`[AI live smoke] provider=${res.provider} model=${res.model} tokens=${res.usage?.totalTokens} costUsd=${res.costUsd} ms=${res.durationMs}\n→ ${res.text}`);
    expect(res.text.trim().length).toBeGreaterThan(5);
    expect(res.cached).toBe(false);
    expect(res.provider).toBeTruthy();
  });
});
