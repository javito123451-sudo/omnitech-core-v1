import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useOrg } from "@/lib/orgContext";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Search, Target, Eye, Phone, Mail, Building2,
  ArrowLeft, ShieldAlert, Loader2,
} from "lucide-react";

interface LeadRow {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  status: string;
  tags?: string | null;
  leadScore?: string | null;
  leadIntent?: string | null;
  createdAt: string;
}

function fetchMyLeads(): Promise<LeadRow[]> {
  return authFetch(`${import.meta.env.BASE_URL}api/clients/my-leads`).then(r => r.json());
}

export default function MyProspectsPage() {
  const { hasPermission } = useOrg();
  const [search, setSearch] = useState("");
  const [, navigate] = useLocation();

  const { data: leads, isLoading } = useQuery({
    queryKey: ["my-leads"],
    queryFn: fetchMyLeads,
  });

  if (!hasPermission("crm.read")) {
    return (
      <div className="p-8 text-center">
        <ShieldAlert className="w-10 h-10 text-destructive mx-auto mb-3" />
        <h2 className="text-lg font-semibold">Acceso restringido</h2>
        <p className="text-muted-foreground">No tienes permiso para ver esta sección.</p>
      </div>
    );
  }

  const filtered = (leads ?? []).filter(l =>
    !search ||
    l.name.toLowerCase().includes(search.toLowerCase()) ||
    l.email.toLowerCase().includes(search.toLowerCase()) ||
    (l.company ?? "").toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/clients")}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Target className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold">Mis Prospectos</h1>
        <Badge variant="secondary">{filtered.length}</Badge>
      </div>

      <div className="flex items-center gap-2">
        <Search className="w-4 h-4 text-muted-foreground" />
        <Input
          placeholder="Buscar prospecto..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" />
          Cargando...
        </div>
      ) : filtered.length === 0 ? (
        <p className="text-muted-foreground py-12 text-center">
          No tienes prospectos asignados.
        </p>
      ) : (
        <div className="grid gap-3">
          {filtered.map(l => (
            <Card key={l.id} className="hover:border-primary/30 transition-colors">
              <CardContent className="p-4 flex flex-col md:flex-row md:items-center gap-3 justify-between">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold">{l.name}</span>
                    <Badge variant="outline">lead</Badge>
                    {l.leadScore && (
                      <Badge variant={l.leadScore === "hot" ? "destructive" : l.leadScore === "warm" ? "default" : "secondary"}>
                        {l.leadScore}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    {l.company && <span className="flex items-center gap-1"><Building2 className="w-3 h-3" />{l.company}</span>}
                    <span className="flex items-center gap-1"><Mail className="w-3 h-3" />{l.email}</span>
                    {l.phone && <span className="flex items-center gap-1"><Phone className="w-3 h-3" />{l.phone}</span>}
                  </div>
                  {l.leadIntent && (
                    <p className="text-sm text-primary">Intención: {l.leadIntent}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => navigate(`/clients?highlight=${l.id}`)}>
                    <Eye className="w-3.5 h-3.5 mr-1" />
                    Ver ficha
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
