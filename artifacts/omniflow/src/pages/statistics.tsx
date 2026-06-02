import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetClientStats, useGetRevenueStats, useGetDashboardStats } from "@workspace/api-client-react";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip as RechartsTooltip, ResponsiveContainer, Legend, Area, AreaChart, Line
} from "recharts";

export default function Statistics() {
  const { data: clientStats, isLoading: clientsLoading } = useGetClientStats();
  const { data: revenueStats, isLoading: revenueLoading } = useGetRevenueStats();
  const { data: stats } = useGetDashboardStats();

  return (
    <div className="space-y-4 animate-in fade-in duration-500">
      <div>
        <h1 className="text-xl md:text-3xl font-bold tracking-tight text-white">Estadísticas</h1>
        <p className="text-muted-foreground text-xs md:text-sm mt-0.5">Análisis profundo de tu rendimiento.</p>
      </div>

      {/* KPI Summary */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: "Clientes Totales", value: stats?.totalClients ?? "—" },
          { label: "Prospectos", value: stats?.leadsThisMonth ?? "—" },
          { label: "Conversión", value: stats ? `${(stats.conversionRate * 100).toFixed(0)}%` : "—" },
        ].map((kpi) => (
          <Card key={kpi.label} className="bg-card border-border">
            <CardContent className="p-3 text-center">
              <p className="text-lg md:text-2xl font-bold text-white">{kpi.value}</p>
              <p className="text-[10px] md:text-xs text-muted-foreground mt-0.5">{kpi.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm md:text-base">Adquisición de Clientes</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <div className="h-[220px] md:h-[300px] w-full">
              {clientsLoading ? (
                <div className="w-full h-full bg-border/20 animate-pulse rounded-lg" />
              ) : clientStats && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={clientStats} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" vertical={false} />
                    <XAxis dataKey="month" stroke="#A0AEC0" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#A0AEC0" fontSize={10} tickLine={false} axisLine={false} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: "#1A202C", borderColor: "#2D3748", color: "#fff", fontSize: 12 }}
                      cursor={{ fill: "#2D3748", opacity: 0.4 }}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="leads" name="Prospectos" fill="#3B82F6" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="converted" name="Convertidos" fill="#10B981" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm md:text-base">Ingresos vs Meta</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <div className="h-[220px] md:h-[300px] w-full">
              {revenueLoading ? (
                <div className="w-full h-full bg-border/20 animate-pulse rounded-lg" />
              ) : revenueStats && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueStats} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" vertical={false} />
                    <XAxis dataKey="month" stroke="#A0AEC0" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#A0AEC0" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
                    <RechartsTooltip
                      contentStyle={{ backgroundColor: "#1A202C", borderColor: "#2D3748", color: "#fff", fontSize: 12 }}
                      formatter={(v: number, name: string) => [`$${v.toLocaleString()}`, name === "revenue" ? "Ingresos" : "Meta"]}
                    />
                    <Legend wrapperStyle={{ fontSize: 11 }} formatter={(v) => v === "revenue" ? "Ingresos" : "Meta"} />
                    <Area type="monotone" dataKey="revenue" name="revenue" stroke="#3B82F6" fillOpacity={1} fill="url(#colorRevenue)" strokeWidth={2} />
                    {revenueStats.some((r) => r.target) && (
                      <Line type="monotone" dataKey="target" name="target" stroke="#10B981" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                    )}
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
