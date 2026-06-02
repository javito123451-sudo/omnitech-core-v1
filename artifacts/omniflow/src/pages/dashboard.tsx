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
  const { data: clientData } = useGetClientStats();
  const { data: activityData } = useGetRecentActivity();

  return (
    <div className="space-y-8 animate-in fade-in zoom-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Dashboard</h1>
          <p className="text-muted-foreground mt-1">Here's what's happening today.</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        <KpiCard 
          title="Total Revenue" 
          value={stats ? `$${stats.totalRevenue.toLocaleString()}` : "..."} 
          icon={<TrendingUp className="w-4 h-4 text-primary" />} 
          trend={stats?.revenueGrowth ? `+${stats.revenueGrowth}%` : undefined}
          loading={statsLoading}
        />
        <KpiCard 
          title="Active Clients" 
          value={stats ? stats.activeClients.toString() : "..."} 
          icon={<Users className="w-4 h-4 text-primary" />} 
          trend={stats?.clientGrowth ? `+${stats.clientGrowth}%` : undefined}
          loading={statsLoading}
        />
        <KpiCard 
          title="Appointments Today" 
          value={stats ? stats.appointmentsToday.toString() : "..."} 
          icon={<Calendar className="w-4 h-4 text-primary" />} 
          loading={statsLoading}
        />
        <KpiCard 
          title="Conversion Rate" 
          value={stats ? `${(stats.conversionRate * 100).toFixed(1)}%` : "..."} 
          icon={<Zap className="w-4 h-4 text-primary" />} 
          loading={statsLoading}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-7">
        {/* Main Chart */}
        <Card className="md:col-span-4 lg:col-span-5 bg-card border-border">
          <CardHeader>
            <CardTitle>Revenue Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {revenueData && (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={revenueData}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" vertical={false} />
                    <XAxis dataKey="month" stroke="#A0AEC0" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#A0AEC0" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: '#1A202C', borderColor: '#2D3748', color: '#fff' }}
                      itemStyle={{ color: '#60A5FA' }}
                    />
                    <Line type="monotone" dataKey="revenue" stroke="#3B82F6" strokeWidth={3} dot={{ r: 4, fill: '#3B82F6', strokeWidth: 2 }} activeDot={{ r: 6 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Activity Feed */}
        <Card className="md:col-span-3 lg:col-span-2 bg-card border-border">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-6">
              {activityData?.slice(0, 5).map((activity, i) => (
                <div key={i} className="flex items-start gap-4">
                  <div className="w-2 h-2 mt-2 rounded-full bg-primary ring-4 ring-primary/20" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium leading-none">{activity.description}</p>
                    <p className="text-xs text-muted-foreground">{new Date(activity.createdAt).toLocaleDateString()}</p>
                  </div>
                </div>
              ))}
              {!activityData?.length && (
                <div className="text-sm text-muted-foreground">No recent activity</div>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function KpiCard({ title, value, icon, trend, loading }: any) {
  return (
    <Card className="bg-card border-border overflow-hidden relative group">
      <div className="absolute inset-0 bg-gradient-to-br from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
      <CardHeader className="flex flex-row items-center justify-between pb-2 space-y-0">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        {icon}
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="h-8 w-24 bg-border/50 animate-pulse rounded" />
        ) : (
          <div className="flex flex-col">
            <div className="text-2xl font-bold text-white">{value}</div>
            {trend && <p className="text-xs text-green-400 mt-1">{trend} from last month</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
