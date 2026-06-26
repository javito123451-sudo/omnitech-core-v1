/**
 * Omni Diagnostics — AI Adapter
 * Verifica: proveedores de IA (OpenAI, Claude, Gemini), API keys, tiempo de respuesta.
 */
import type { DiagnosticAdapter, DiagnosticContext, ModuleDiagnosticResult } from "../types";

const AI_PROVIDERS: Array<{ name: string; key: string; testUrl: string }> = [
  { name: "OpenAI", key: "OPENAI_API_KEY", testUrl: "https://api.openai.com/v1/models" },
  { name: "Claude", key: "ANTHROPIC_API_KEY", testUrl: "https://api.anthropic.com/v1/models" },
  { name: "Gemini", key: "GEMINI_API_KEY", testUrl: "https://generativelanguage.googleapis.com/v1/models" },
];

export const aiAdapter: DiagnosticAdapter = {
  name: "ai",
  priority: 30,

  async run(ctx: DiagnosticContext): Promise<ModuleDiagnosticResult> {
    const checks: ModuleDiagnosticResult["checks"] = [];
    const issues: ModuleDiagnosticResult["issues"] = [];
    const recommendations: ModuleDiagnosticResult["recommendations"] = [];
    const t0 = Date.now();

    for (const provider of AI_PROVIDERS) {
      const pT0 = Date.now();
      const key = process.env[provider.key];
      if (!key) {
        checks.push({
          name: `ai_${provider.name.toLowerCase()}_key`,
          status: "skip",
          message: `${provider.name} no configurado (sin ${provider.key})`,
          durationMs: Date.now() - pT0,
        });
        continue;
      }

      // Check API key validity with a lightweight call
      try {
        const resp = await fetch(provider.testUrl, {
          method: "GET",
          headers: {
            "Authorization": provider.name === "OpenAI" ? `Bearer ${key}` : provider.name === "Claude" ? `x-api-key: ${key}` : "",
          },
        });
        const ok = resp.ok;
        const durationMs = Date.now() - pT0;
        checks.push({
          name: `ai_${provider.name.toLowerCase()}_api`,
          status: ok ? "pass" : "fail",
          message: ok
            ? `${provider.name} API responde (${durationMs}ms)`
            : `${provider.name} API error: ${resp.status} ${resp.statusText}`,
          durationMs,
          detail: { status: resp.status },
        });
        if (!ok) {
          issues.push({
            id: `ai-${provider.name.toLowerCase()}-fail`,
            module: "ai",
            severity: "critical",
            title: `${provider.name} API no responde`,
            description: `Código ${resp.status}: ${resp.statusText}`,
            autoFixable: false,
          });
        } else if (durationMs > 5000) {
          recommendations.push({
            id: `ai-${provider.name.toLowerCase()}-slow`,
            module: "ai",
            severity: "warning",
            title: `${provider.name} lento`,
            description: `Respuesta: ${durationMs}ms. Considerar timeout de reserva.`,
          });
        }
      } catch (err) {
        const durationMs = Date.now() - pT0;
        checks.push({
          name: `ai_${provider.name.toLowerCase()}_api`,
          status: "fail",
          message: `Error: ${(err as Error).message}`,
          durationMs,
        });
        issues.push({
          id: `ai-${provider.name.toLowerCase()}-error`,
          module: "ai",
          severity: "critical",
          title: `${provider.name} API no accesible`,
          description: (err as Error).message,
          autoFixable: false,
        });
      }
    }

    // Check OpenAI key format
    const openaiKey = process.env["OPENAI_API_KEY"];
    if (openaiKey) {
      const formatT0 = Date.now();
      const validFormat = openaiKey.startsWith("sk-") && openaiKey.length > 30;
      checks.push({
        name: "ai_openai_key_format",
        status: validFormat ? "pass" : "warn",
        message: validFormat ? "Formato de API key OpenAI válido" : "Formato de API key OpenAI inusual",
        durationMs: Date.now() - formatT0,
      });
      if (!validFormat) {
        recommendations.push({
          id: "ai-openai-key-format",
          module: "ai",
          severity: "warning",
          title: "API key OpenAI con formato inusual",
          description: "La clave no comienza con 'sk-'. Verificar si es correcta.",
        });
      }
    }

    // Calculate score
    const passCount = checks.filter((c) => c.status === "pass").length;
    const total = checks.filter((c) => c.status !== "skip").length || 1;
    const score = Math.round((passCount / total) * 100);
    const status: ModuleDiagnosticResult["status"] = issues.some((i) => i.severity === "critical")
      ? "unhealthy"
      : issues.some((i) => i.severity === "warning") || checks.some((c) => c.status === "warn")
        ? "degraded"
        : "healthy";

    return {
      module: "ai",
      score,
      status,
      checks,
      issues,
      recommendations,
      durationMs: Date.now() - t0,
    };
  },
};
