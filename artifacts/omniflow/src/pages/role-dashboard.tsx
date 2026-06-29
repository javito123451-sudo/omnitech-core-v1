import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useOrg } from "@/lib/orgContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Users, TrendingUp, DollarSign, Target, Calendar, AlertTriangle,
  ChevronRight, UserCheck, BarChart3, ArrowUpRight, ArrowDownRight,
  Ticket, Zap, Clock, FileText, Settings,
} from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface PipelineSummaryItem {
  stageId: number;
  name: string;
  color: string;
  count: number;
  value: number;
}

interface RoleDashboardData {
  role: string;
  orgId: number;
  totalClients: number;
  activeClients: number;
  leadsCount: number;
  todayAppointments: number;
  pipelineValue: number;
  confirmedValue: number;
  conversionRate: number;
  openTickets: number;
  pipelineSummary: PipelineSummaryItem[];
  // Admin fields
  memberCount?: number;
  totalCommission?: number;
  isAdmin?: boolean;
  // Seller fields
  myLeads?: number;
  myCustomers?: number;
  myCommission?: number;
  myPipeline?: PipelineSummaryItem[];
  isSeller?: boolean;
}

async function fetchRoleDashboard(): Promise<RoleDashboardData> {
  const res = await authFetch(`${BASE}/api/dashboard/role`);
  if (!res.ok) throw new Error("Error cargando dashboard");
  return res.json();
}

function KpiCard({ title, value, icon, subtext, color = "blue", loading, onClick }: {
  title: string; value: string | number; icon: React.ReactNode;
  subtext?: string; color?: string; loading?: boolean; onClick?: () => void;
}) {
  const colorMap: Record<string, string> = {
    blue: "bg-blue-500/10 text-blue-400 border-blue-500/20",
    emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    violet: "bg-violet-500/10 text-violet-400 border-violet-500/20",
    amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
    rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
    sky: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  };
  return (
    <Card className={cn("bg-card border-border hover:border-white/10 transition-all", onClick && "cursor-pointer")} onClick={onClick}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground font-medium">{title}</p>
            {loading ? (
              <div className="h-6 w-16 bg-muted/40 rounded animate-pulse" />
            ) : (
              <p className="text-2xl font-bold text-white">{value}</p>
            )}
            {subtext && <p className="text-[10px] text-muted-foreground">{subtext}</p>}
          </div>
          <div className={cn("w-9 h-9 rounded-lg flex items-center justify-center border", colorMap[color])}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function PipelineBar({ summary, mySummary }: { summary: PipelineSummaryItem[]; mySummary?: PipelineSummaryItem[] }) {
  const data = mySummary ?? summary;
  const totalCount = data.reduce((s, d) => s + d.count, 0);
  if (totalCount === 0) return (
    <div className="text-center py-8 text-muted-foreground text-sm">
      <Target className="w-8 h-8 mx-auto mb-2 opacity-30" />
      No hay oportunidades en el pipeline
    </div>
  );
  return (
    <div className="space-y-3">
      {data.map((stage) => (
        <div key={stage.stageId} className="flex items-center gap-3">
          <div className="w-28 shrink-0">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stage.color }} />
              <span className="text-xs text-muted-foreground truncate">{stage.name}</span>
            </div>
          </div>
          <div className="flex-1">
            <div className="h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{
                  width: `${Math.max((stage.count / totalCount) * 100, 3)}%`,
                  backgroundColor: stage.color,
                }}
              />
            </div>
          </div>
          <div className="w-16 text-right shrink-0">
            <span className="text-xs font-medium text-white">{stage.count}</span>
            <span className="text-[10px] text-muted-foreground ml-1">€{stage.value.toLocaleString(undefined, {maximumFractionDigits:0})}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export default function RoleDashboard() {
  const { org } = useOrg();
  const [, setLocation] = useLocation();
  const { data, isLoading } = useQuery({ queryKey: ["dashboard-role"], queryFn: fetchRoleDashboard });

  const role = data?.role ?? org?.role ?? "member";
  const isAdmin = data?.isAdmin ?? ["owner", "admin"].includes(role);
  const isSeller = data?.isSeller ?? role === "vendedor";

  return (
    <div className="space-y-5 animate-in fade-in duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">
            {isAdmin ? "Dashboard Administrador" : isSeller ? "Dashboard Vendedor" : "Dashboard"}
          </h1>
          <p className="text-muted-foreground text-xs mt-0.5">
            {org?.name ?? "Workspace"} • <span className="capitalize">{role}</span>
          </p>
        </div>
        {isAdmin && (
          <Badge variant="outline" className="text-amber-400 border-amber-500/30 bg-amber-500/10">
            <Zap className="w-3 h-3 mr-1" /> Admin
          </Badge>
        )}
        {isSeller && (
          <Badge variant="outline" className="text-violet-400 border-violet-500/30 bg-violet-500/10">
            <Target className="w-3 h-3 mr-1" /> Vendedor
          </Badge>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          title="Clientes"
          value={data?.totalClients ?? "—"}
          icon={<Users className="w-4 h-4" />}
          subtext={`${data?.activeClients ?? 0} activos`}
          color="blue"
          loading={isLoading}
          onClick={() => setLocation("/clients")}
        />
        <KpiCard
          title={isSeller ? "Mis Prospectos" : "Leads"}
          value={isSeller ? (data?.myLeads ?? "—") : (data?.leadsCount ?? "—")}
          icon={<Target className="w-4 h-4" />}
          color="amber"
          loading={isLoading}
          onClick={() => isSeller ? setLocation("/my-prospects") : setLocation("/clients")}
        />
        <KpiCard
          title="Pipeline"
          value={data ? `€${(data.pipelineValue / 1000).toFixed(0)}k` : "—"}
          icon={<TrendingUp className="w-4 h-4" />}
          subtext={`${data?.confirmedValue ? `€${(data.confirmedValue/1000).toFixed(0)}k confirmado` : ""}`}
          color="violet"
          loading={isLoading}
          onClick={() => setLocation("/pipeline")}
        />
        <KpiCard
          title={isSeller ? "Mi Comisión" : "Comisiones"}
          value={isSeller
            ? (data?.myCommission ? `€${data.myCommission.toFixed(0)}` : "—")
            : (data?.totalCommission ? `€${data.totalCommission.toFixed(0)}` : "—")
          }
          icon={<DollarSign className="w-4 h-4" />}
          color="emerald"
          loading={isLoading}
          onClick={() => isSeller ? setLocation("/my-commissions") : undefined}
        />
      </div>

      {/* Secondary row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          title="Tasa Conversión"
          value={data ? `${data.conversionRate}%` : "—"}
          icon={<BarChart3 className="w-4 h-4" />}
          color="sky"
          loading={isLoading}
        />
        <KpiCard
          title="Citas Hoy"
          value={data?.todayAppointments ?? "—"}
          icon={<Calendar className="w-4 h-4" />}
          color="rose"
          loading={isLoading}
          onClick={() => setLocation("/calendar")}
        />
        {isAdmin && (
          <KpiCard
            title="Miembros"
            value={data?.memberCount ?? "—"}
            icon={<UserCheck className="w-4 h-4" />}
            color="blue"
            loading={isLoading}
          />
        )}
        {isSeller && (
          <KpiCard
            title="Mis Clientes"
            value={data?.myCustomers ?? "—"}
            icon={<UserCheck className="w-4 h-4" />}
            color="blue"
            loading={isLoading}
            onClick={() => setLocation("/my-customers")}
          />
        )}
        <KpiCard
          title="Tickets Abiertos"
          value={data?.openTickets ?? "—"}
          icon={<Ticket className="w-4 h-4" />}
          color="amber"
          loading={isLoading}
          onClick={() => setLocation("/support")}
        />
      </div>

      {/* Pipeline + Quick Actions */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold">Pipeline Comercial</CardTitle>
              <button onClick={() => setLocation("/pipeline")} className="text-xs text-primary hover:underline flex items-center gap-0.5">
                Ver todo <ChevronRight className="w-3 h-3" />
              </button>
            </div>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <PipelineBar summary={data?.pipelineSummary ?? []} mySummary={data?.myPipeline} />
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-semibold">Accesos Rápidos</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-1.5">
            {isAdmin && (
              <>
                <QuickLink icon={<Users className="w-4 h-4" />} label="Gestionar Clientes" href="/clients" onClick={() => setLocation("/clients")} />
                <QuickLink icon={<FileText className="w-4 h-4" />} label="Presupuestos" href="/quotes" onClick={() => setLocation("/quotes")} />
                <QuickLink icon={<Calendar className="w-4 h-4" />} label="Calendario" href="/calendar" onClick={() => setLocation("/calendar")} />
                <QuickLink icon={<Settings className="w-4 h-4" />} label="Configuración" href="/settings" onClick={() => setLocation("/settings")} />
              </>
            )}
            {isSeller && (
              <>
                <QuickLink icon={<Target className="w-4 h-4" />} label="Mis Prospectos" href="/my-prospects" onClick={() => setLocation("/my-prospects")} />
                <QuickLink icon={<UserCheck className="w-4 h-4" />} label="Mis Clientes" href="/my-customers" onClick={() => setLocation("/my-customers")} />
                <QuickLink icon={<DollarSign className="w-4 h-4" />} label="Mis Comisiones" href="/my-commissions" onClick={() => setLocation("/my-commissions")} />
                <QuickLink icon={<Calendar className="w-4 h-4" />} label="Calendario" href="/calendar" onClick={() => setLocation("/calendar")} />
              </>
            )}
            {!isAdmin && !isSeller && (
              <>
                <QuickLink icon={<Users className="w-4 h-4" />} label="Clientes" href="/clients" onClick={() => setLocation("/clients")} />
                <QuickLink icon={<FileText className="w-4 h-4" />} label="Presupuestos" href="/quotes" onClick={() => setLocation("/quotes")} />
                <QuickLink icon={<Calendar className="w-4 h-4" />} label="Calendario" href="/calendar" onClick={() => setLocation("/calendar")} />
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function QuickLink({ icon, label, onClick }: { icon: React.ReactNode; label: string; href: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center justify-between px-3 py-2.5 rounded-lg bg-muted/20 hover:bg-muted/40 transition-colors text-left"
    >
      <div className="flex items-center gap-2.5">
        <span className="text-muted-foreground">{icon}</span>
        <span className="text-sm text-foreground">{label}</span>
      </div>
      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground" />
    </button>
  );
}

