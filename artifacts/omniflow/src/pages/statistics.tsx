import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useGetClientStats, useGetRevenueStats } from "@workspace/api-client-react";
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend, Area, AreaChart } from "recharts";

export default function Statistics() {
  const { data: clientStats, isLoading: clientsLoading } = useGetClientStats();
  const { data: revenueStats, isLoading: revenueLoading } = useGetRevenueStats();

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-white">Statistics</h1>
          <p className="text-muted-foreground mt-1">Deep dive into your performance metrics.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Client Acquisition Funnel</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full">
              {clientsLoading ? (
                <div className="w-full h-full bg-border/20 animate-pulse rounded-lg" />
              ) : clientStats && (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={clientStats} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" vertical={false} />
                    <XAxis dataKey="month" stroke="#A0AEC0" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#A0AEC0" fontSize={12} tickLine={false} axisLine={false} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: '#1A202C', borderColor: '#2D3748', color: '#fff' }}
                      cursor={{fill: '#2D3748', opacity: 0.4}}
                    />
                    <Legend />
                    <Bar dataKey="leads" name="New Leads" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="converted" name="Converted" fill="#10B981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle>Revenue vs Target</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[350px] w-full">
              {revenueLoading ? (
                <div className="w-full h-full bg-border/20 animate-pulse rounded-lg" />
              ) : revenueStats && (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={revenueStats} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#2D3748" vertical={false} />
                    <XAxis dataKey="month" stroke="#A0AEC0" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="#A0AEC0" fontSize={12} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: '#1A202C', borderColor: '#2D3748', color: '#fff' }}
                    />
                    <Legend />
                    <Area type="monotone" dataKey="revenue" name="Actual Revenue" stroke="#3B82F6" fillOpacity={1} fill="url(#colorRevenue)" strokeWidth={3} />
                    {revenueStats.some(r => r.target) && (
                      <Line type="monotone" dataKey="target" name="Target" stroke="#10B981" strokeDasharray="5 5" strokeWidth={2} dot={false} />
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
