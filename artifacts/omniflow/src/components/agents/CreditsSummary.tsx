import type { UseQueryResult } from "@tanstack/react-query";
import { Coins, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { ApiErrorAlert } from "@/components/agents/ApiErrorAlert";
import { formatCredits, formatDate } from "@/lib/agents/format";
import type { CreditAlert, CreditsBalance, CreditsDashboard } from "@/lib/agents/types";

function Stat({ label, value, hint, testId }: { label: string; value: string; hint?: string; testId: string }) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="text-base font-semibold text-foreground truncate">{value}</p>
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Aviso legible a partir de lo que guarda credit_alerts (kind + threshold), sin inventar datos. */
function alertText(a: CreditAlert): string {
  if (a.kind === "threshold") return `El consumo de este periodo ha superado el ${a.threshold} % de tus créditos.`;
  if (a.kind === "anomaly") return "Se ha detectado un consumo anormalmente alto.";
  return `Aviso de créditos (${a.kind}).`;
}

/**
 * Bloque de créditos del workspace. Datos reales de GET /api/agents/credits/balance y GET /api/agents/credits.
 * Solo créditos: ni tokens ni dinero. Si parte del consumo usó un precio provisional, se dice claramente.
 */
export function CreditsSummary({ balance, dashboard }: { balance: UseQueryResult<CreditsBalance>; dashboard: UseQueryResult<CreditsDashboard> }) {
  const d = dashboard.data;
  const provisional = d ? d.pricing.provisional || d.provisionalCredits > 0 : false;

  return (
    <Card data-testid="credits-summary">
      <CardContent className="p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground flex items-center gap-1.5"><Coins className="h-3.5 w-3.5" /> Saldo disponible</p>
            {balance.isPending ? (
              <Skeleton className="mt-1 h-8 w-32" data-testid="balance-loading" />
            ) : balance.isError ? null : (
              <>
                <p className="text-3xl font-bold text-foreground" data-testid="balance-available">
                  {formatCredits(balance.data.available)} <span className="text-sm font-normal text-muted-foreground">créditos</span>
                </p>
                {balance.data.held > 0 && (
                  <p className="text-[11px] text-muted-foreground" data-testid="balance-held">
                    {formatCredits(balance.data.held)} retenidos por operaciones en curso
                  </p>
                )}
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {d?.plan && <Badge variant="outline" className="capitalize" data-testid="credits-plan">Plan {d.plan}</Badge>}
            {provisional && (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-400" data-testid="provisional-badge">
                Precio provisional
              </Badge>
            )}
          </div>
        </div>

        {balance.isError && <ApiErrorAlert error={balance.error} onRetry={() => void balance.refetch()} />}

        {dashboard.isPending && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4" data-testid="credits-loading">
            {Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
          </div>
        )}
        {dashboard.isError && <ApiErrorAlert error={dashboard.error} onRetry={() => void dashboard.refetch()} />}

        {d && (
          <>
            <div>
              <div className="flex items-center justify-between text-xs text-muted-foreground mb-1.5">
                <span>Uso del periodo</span>
                <span data-testid="usage-percentage">
                  {d.usagePercentage !== null ? `${d.usagePercentage} % consumido` : "Sin créditos del plan configurados"}
                </span>
              </div>
              <Progress value={Math.min(d.usagePercentage ?? 0, 100)} aria-label="Porcentaje de créditos consumidos" />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3">
              <Stat testId="stat-used" label="Usados en el periodo" value={formatCredits(d.creditsUsed)} hint={`Hoy: ${formatCredits(d.usedToday)}`} />
              <Stat testId="stat-plan-credits" label="Créditos del plan" value={formatCredits(d.monthlyCredits)} />
              <Stat testId="stat-monthly-limit" label="Límite mensual" value={d.limits?.monthly != null ? formatCredits(d.limits.monthly) : "Sin límite"} />
              <Stat testId="stat-daily-limit" label="Límite diario" value={d.limits?.daily != null ? formatCredits(d.limits.daily) : "Sin límite"} />
              <Stat testId="stat-rollover" label="Rollover" value={formatCredits(d.rolloverCredits)} />
              <Stat testId="stat-extra" label="Créditos extra" value={formatCredits(d.extraCredits)} />
              <Stat testId="stat-included" label="Incluidos restantes" value={formatCredits(d.includedRemaining)} />
              <Stat testId="stat-renewal" label="Renovación" value={formatDate(d.renewalDate)} />
            </div>

            {provisional && (
              <p className="flex items-start gap-1.5 text-xs text-amber-400/90" data-testid="provisional-note">
                <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                {formatCredits(d.provisionalCredits)} créditos de este periodo se calcularon con un precio provisional (todavía no definitivo).
              </p>
            )}

            {d.alerts.length > 0 && (
              <ul className="space-y-1" data-testid="credit-alerts">
                {d.alerts.map((a) => (
                  <li key={a.id} className="text-xs text-amber-300 bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-1.5">{alertText(a)}</li>
                ))}
              </ul>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
