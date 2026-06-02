import { useListClients } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Search, Plus, Building2, DollarSign } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";

export default function Clients() {
  const { data: clients, isLoading } = useListClients();
  const [search, setSearch] = useState("");

  const filtered = clients?.filter((c) =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase()) ||
    (c.company ?? "").toLowerCase().includes(search.toLowerCase())
  );

  const getStatusColor = (status: string) => {
    switch (status) {
      case "active":   return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
      case "lead":     return "bg-blue-500/10 text-blue-400 border-blue-500/20";
      case "inactive": return "bg-slate-500/10 text-slate-400 border-slate-500/20";
      case "churned":  return "bg-red-500/10 text-red-400 border-red-500/20";
      default:         return "bg-slate-500/10 text-slate-400 border-slate-500/20";
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-500 h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl md:text-3xl font-bold tracking-tight text-white">Clients</h1>
          <p className="text-muted-foreground text-xs md:text-sm mt-0.5 hidden sm:block">Manage your pipeline and customer relationships.</p>
        </div>
        <Button size="sm" className="bg-primary text-primary-foreground hover:bg-primary/90 shrink-0 shadow-[0_0_15px_rgba(59,130,246,0.3)]">
          <Plus className="w-4 h-4 mr-1 md:mr-2" />
          <span className="hidden sm:inline">New </span>Client
        </Button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Search clients..."
          className="pl-9 bg-background/50 border-border text-sm"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {/* Client cards (mobile) / Table (desktop) */}
      <div className="flex-1 overflow-hidden">
        {/* Mobile card list */}
        <div className="md:hidden space-y-2 overflow-y-auto h-full pb-2">
          {isLoading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="h-20 bg-card border border-border rounded-lg animate-pulse" />
            ))
          ) : filtered?.map((client) => (
            <Card key={client.id} className="bg-card border-border cursor-pointer hover:border-primary/40 transition-colors">
              <CardContent className="p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-semibold text-white text-sm truncate">{client.name}</p>
                      <Badge variant="outline" className={`${getStatusColor(client.status)} text-[9px] px-1.5 py-0 shrink-0`}>
                        {client.status.toUpperCase()}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{client.email}</p>
                    {client.company && (
                      <div className="flex items-center gap-1 mt-1">
                        <Building2 className="w-3 h-3 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground truncate">{client.company}</p>
                      </div>
                    )}
                  </div>
                  {client.value ? (
                    <div className="flex items-center gap-0.5 text-white font-semibold text-sm shrink-0">
                      <DollarSign className="w-3 h-3 text-primary" />
                      {(client.value / 1000).toFixed(0)}k
                    </div>
                  ) : null}
                </div>
              </CardContent>
            </Card>
          ))}
          {!isLoading && !filtered?.length && (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <p className="text-sm">No clients found.</p>
            </div>
          )}
        </div>

        {/* Desktop table */}
        <Card className="hidden md:flex bg-card border-border flex-col overflow-hidden h-full">
          <CardContent className="flex-1 overflow-auto p-0">
            <table className="w-full text-sm">
              <thead className="bg-background/50 sticky top-0 z-10">
                <tr className="border-b border-border">
                  <th className="text-left text-muted-foreground font-medium px-4 py-3">Name</th>
                  <th className="text-left text-muted-foreground font-medium px-4 py-3">Company</th>
                  <th className="text-left text-muted-foreground font-medium px-4 py-3">Status</th>
                  <th className="text-left text-muted-foreground font-medium px-4 py-3">Value</th>
                  <th className="text-right text-muted-foreground font-medium px-4 py-3">Added</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td colSpan={5} className="text-center py-8 text-muted-foreground">Loading clients...</td>
                  </tr>
                ) : filtered?.map((client) => (
                  <tr key={client.id} className="border-b border-border hover:bg-white/5 cursor-pointer transition-colors group">
                    <td className="px-4 py-3 font-medium text-white group-hover:text-primary transition-colors">
                      {client.name}
                      <div className="text-xs text-muted-foreground font-normal mt-0.5">{client.email}</div>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{client.company || "—"}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline" className={getStatusColor(client.status)}>
                        {client.status.toUpperCase()}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-white font-medium">
                      {client.value ? `$${client.value.toLocaleString()}` : "—"}
                    </td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {new Date(client.createdAt).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
                {!isLoading && !filtered?.length && (
                  <tr>
                    <td colSpan={5} className="text-center py-16 text-muted-foreground">
                      No clients found. Add one to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
