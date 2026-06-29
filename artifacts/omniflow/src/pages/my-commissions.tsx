import { useQuery } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useOrg } from "@/lib/orgContext";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp, Euro, ShoppingBag, ShieldAlert, Loader2,
} from "lucide-react";

interface CommissionDeal {
  id: number;
  title: string;
  clientName: string;
  clientCompany: string | null;
  total: number;
  createdAt: string;
  commission: number;
}

interface CommissionsData {
  totalSales: number;
  commissionRate: number;
  totalCommission: number;
  count: number;
  deals: CommissionDeal[];
}

function fetchMyCommissions(): Promise<CommissionsData> {
  return authFetch(`${import.meta.env.BASE_URL}api/quotes/my-commissions`).then(r => r.json());
}

export default function MyCommissionsPage() {
  const { hasPermission } = useOrg();

  const { data, isLoading } = useQuery({
    queryKey: ["my-commissions"],
    queryFn: fetchMyCommissions,
  });

  if (!hasPermission("quotes.read")) {
    return (
      <div className="p-8 text-center">
        <ShieldAlert className="w-10 h-10 text-destructive mx-auto mb-3" />
        <h2 className="text-lg font-semibold">Acceso restringido</h2>
        <p className="text-muted-foreground">No tienes permiso para ver esta sección.</p>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center gap-3">
        <TrendingUp className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-bold">Mis Comisiones</h1>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
          <Loader2 className="w-5 h-5 animate-spin" />
          Cargando...
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-5 space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <ShoppingBag className="w-4 h-4" />
                  Ventas totales
                </div>
                <p className="text-2xl font-bold">
                  {(data?.totalSales ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
                </p>
                <p className="text-xs text-muted-foreground">{data?.count ?? 0} presupuestos aceptados</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <Euro className="w-4 h-4" />
                  Comisión total
                </div>
                <p className="text-2xl font-bold text-emerald-600">
                  {(data?.totalCommission ?? 0).toLocaleString("es-ES", { style: "currency", currency: "EUR" })}
                </p>
                <p className="text-xs text-muted-foreground">
                  Tasa: {((data?.commissionRate ?? 0.10) * 100).toFixed(0)}%
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5 space-y-1">
                <div className="flex items-center gap-2 text-muted-foreground text-sm">
                  <TrendingUp className="w-4 h-4" />
                  Promedio por venta
                </div>
                <p className="text-2xl font-bold">
                  {data && data.count > 0
                    ? (data.totalSales / data.count).toLocaleString("es-ES", { style: "currency", currency: "EUR" })
                    : "0,00 €"}
                </p>
              </CardContent>
            </Card>
          </div>

          <h2 className="font-semibold text-sm uppercase tracking-wider text-muted-foreground mt-6">
            Detalle de ventas
          </h2>

          {(data?.deals ?? []).length === 0 ? (
            <p className="text-muted-foreground py-8 text-center">
              Aún no tienes ventas registradas.
            </p>
          ) : (
            <div className="grid gap-3">
              {data!.deals.map(d => (
                <Card key={d.id} className="hover:border-primary/30 transition-colors">
                  <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold">{d.title}</span>
                        <Badge variant="outline">{d.clientName}</Badge>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {d.clientCompany || ""} • {new Date(d.createdAt).toLocaleDateString("es-ES")}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{d.total.toLocaleString("es-ES", { style: "currency", currency: "EUR" })}</p>
                      <p className="text-sm text-emerald-600">
                        +{d.commission.toLocaleString("es-ES", { style: "currency", currency: "EUR" })} comisión
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
