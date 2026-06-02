import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Users, TrendingUp, Calendar, Zap, Activity } from "lucide-react";
import { 
  useGetDashboardStats, 
  useGetRevenueStats, 
  useGetClientStats, 
  useGetRecentActivity 
} from "@workspace/api-client-react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer } from "recharts";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetDashboardStats();
  const { data: revenueData } = useGetRevenueStats();
  const { data: activityData } = useGetRecentActivity();

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in zoom-in duration-500">
      <div>
        <h1 className="text-xl md:text-3xl font-bold tracking-tight text-white">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-0.5">Here's what's happening today.</p>
      </div>

      {/* KPI Cards — 2 cols on mobile, 4 on desktop */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 md:gap-4">
        <KpiCard 
          title="Total Revenue" 
          value={stats ? `$${(stats.totalRevenue / 1000).toFixed(0)}k` : "—"} 
          valueFull={stats ? `$${stats.totalRevenue.toLocaleString()}` : "—"}
          icon={<TrendingUp className="w-4 h-4 text-primary" />} 
          trend={stats?.revenueGrowth ? `+${stats.revenueGrowth}%` : undefined}
          loading={statsLoading}
        />
        <KpiCard 
          title="Active Clients" 
          value={stats ? stats.activeClients.toString() : "—"} 
          icon={<Users className="w-4 h-4 text-primary" />} 
          trend={stats?.clientGrowth ? `+${stats.clientGrowth}%` : undefined}
          loading={statsLoading}
        />
        <KpiCard 
          title="Appts Today" 
          value={stats ? stats.appointmentsToday.toString() : "—"} 
          icon={<Calendar className="w-4 h-4 text-primary" />} 
          loading={statsLoading}
        />
        <KpiCard 
          title="Conversion" 
          value={stats ? `${(stats.conversionRate * 100).toFixed(0)}%` : "—"} 
          icon={<Zap className="w-4 h-4 text-primary" />} 
          loading={statsLoading}
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-7 gap-4">
        {/* Revenue Chart */}
        <Card className="lg:col-span-5 bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm md:text-base">Revenue Overview</CardTitle>
          </CardHeader>
          <CardContent className="px-2 pb-3">
            <div className="h-[200px] md:h-[280px] w-full">
              {revenueData && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueData} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" vertical={false} />
                    <XAxis dataKey="month" stroke="#A0AEC0" fontSize={10} tickLine={false} axisLine={false} />
                    <YAxis stroke="#A0AEC0" fontSize={10} tickLine={false} axisLine={false} tickFormatter={(v) => `$${(v/1000).toFixed(0)}k`} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: '#1A202C', borderColor: '#2D3748', color: '#fff', fontSize: 12 }}
                      itemStyle={{ color: '#60A5FA' }}
                    />
                    <Line type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={2} dot={{ r: 3, fill: '#3B82F6', strokeWidth: 2 }} activeDot={{ r: 5 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card className="lg:col-span-2 bg-card border-border">
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm md:text-base flex items-center gap-2">
              <Activity className="w-4 h-4 text-primary shrink-0" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-3">
            <div className="space-y-3">
              {activityData?.slice(0, 6).map((activity, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 mt-2 rounded-full bg-primary ring-4 ring-primary/20 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-xs font-medium leading-snug line-clamp-2">{activity.description}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">{new Date(activity.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
              {!activityData?.length && (
                <div className="text-xs text-muted-foreground py-4 text-center">No recent activity</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ title, value, icon, trend, loading }: {
  title: string;
  value: string;
  valueFull?: string;
  icon: React.ReactNode;
  trend?: string;
  loading?: boolean;
}) {
  return (
    <Card className="bg-card border-border overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardContent className="p-3 md:p-4">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] md:text-xs font-medium text-muted-foreground leading-tight">{title}</p>
          <div className="shrink-0">{icon}</div>
        </div>
        {loading ? (
          <div className="h-7 w-16 bg-border/50 animate-pulse rounded" />
        ) : (
          <div>
            <div className="text-lg md:text-2xl font-bold text-white leading-none">{value}</div>
            {trend && <p className="text-[10px] text-green-400 mt-1">{trend}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
