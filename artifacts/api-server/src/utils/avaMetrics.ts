// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2 — Routing Metrics
//  Tracks % of calls routed through Skill Engine vs direct LLM
// ═══════════════════════════════════════════════════════════════════════════

interface MetricsSnapshot {
  skillEngineCalls: number;
  llmDirectCalls: number;
  totalCalls: number;
  skillEnginePct: number;
  llmDirectPct: number;
}

const metrics = {
  skillEngineCalls: 0,
  llmDirectCalls: 0,
};

export function trackSkillEngineCall(): void {
  metrics.skillEngineCalls++;
}

export function trackLLMDirectCall(): void {
  metrics.llmDirectCalls++;
}

export function getMetrics(): MetricsSnapshot {
  const total = metrics.skillEngineCalls + metrics.llmDirectCalls;
  return {
    skillEngineCalls: metrics.skillEngineCalls,
    llmDirectCalls:   metrics.llmDirectCalls,
    totalCalls:       total,
    skillEnginePct:   total > 0 ? Math.round((metrics.skillEngineCalls / total) * 100) : 0,
    llmDirectPct:     total > 0 ? Math.round((metrics.llmDirectCalls / total) * 100) : 0,
  };
}

export function resetMetrics(): void {
  metrics.skillEngineCalls = 0;
  metrics.llmDirectCalls = 0;
}
