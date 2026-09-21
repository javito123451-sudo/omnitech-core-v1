import { useState } from "react";
import { Wrench, Package, Clock, CheckCircle2, ServerCrash, RefreshCw, Plus, Pencil, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  REPAIR_STAGES, SERVICE_LABEL, STAGE_LABEL, useRepairOrders, useTallerDashboard, useTallerPermissions, useUpdateOrder,
  type RepairOrder, type TallerDashboard,
} from "@/lib/taller/tallerApi";
import { OrderForm } from "@/components/taller/OrderForm";
import { EmptyState, inputCls, primaryBtn } from "@/components/fleet/fleetUi";

const EMPTY_DASHBOARD: TallerDashboard = { totalActive: 0, readyForPickup: 0, inRepair: 0, waitingParts: 0, byStage: {} };

const STAGE_STYLE: Record<string, string> = {
  received:      "bg-slate-500/20 text-slate-400 border-slate-500/30",
  diagnosing:    "bg-blue-500/20 text-blue-400 border-blue-500/30",
  quote_sent:    "bg-purple-500/20 text-purple-400 border-purple-500/30",
  approved:      "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  in_repair:     "bg-amber-500/20 text-amber-400 border-amber-500/30",
  waiting_parts: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  ready:         "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  delivered:     "bg-slate-600/20 text-slate-500 border-slate-600/30",
  cancelled:     "bg-red-500/20 text-red-400 border-red-500/30",
};

function StageBadge({ s }: { s: string }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${STAGE_STYLE[s] ?? STAGE_STYLE["received"]}`}>
      {STAGE_LABEL[s] ?? s}
    </span>
  );
}

function StatCard({ icon: Icon, label, value, color = "text-white" }: {
  icon: React.ElementType; label: string; value: number | string; color?: string;
}) {
  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 flex items-center gap-4">
      <div className="w-10 h-10 rounded-lg bg-slate-700/60 flex items-center justify-center shrink-0">
        <Icon className={`w-5 h-5 ${color}`} />
      </div>
      <div>
        <p className="text-xs text-slate-400">{label}</p>
        <p className={`text-2xl font-bold ${color}`}>{value}</p>
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message?: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <div className="w-14 h-14 rounded-2xl bg-red-900/30 border border-red-700/40 flex items-center justify-center mb-4">
        <ServerCrash className="w-7 h-7 text-red-400" />
      </div>
      <h3 className="text-base font-semibold text-slate-200 mb-2">Error al cargar los datos</h3>
      <p className="text-sm text-slate-500 max-w-xs mb-6">{message ?? "Comprueba la conexión y vuelve a intentarlo."}</p>
      {onRetry && (
        <button onClick={onRetry} className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm font-medium transition-colors">
          <RefreshCw className="w-4 h-4" /> Reintentar
        </button>
      )}
    </div>
  );
}

// ── Fila de orden con selector de fase inline y edición ─────────────────────

function OrderRow({ order, canWrite, onEdit }: { order: RepairOrder; canWrite: boolean; onEdit: (o: RepairOrder) => void }) {
  const { toast } = useToast();
  const update = useUpdateOrder();

  const changeStage = async (stage: string) => {
    try { await update.mutateAsync({ id: order.id, patch: { stage } }); }
    catch (e) { toast({ title: (e as Error).message, variant: "destructive" }); }
  };

  return (
    <tr className="border-b border-slate-800">
      <td className="py-3 font-medium text-slate-200">{order.clientName ?? "—"}</td>
      <td className="py-3 text-slate-400">
        {order.vehiclePlate ?? "—"}{order.vehicleModel ? ` · ${order.vehicleModel}` : ""}
      </td>
      <td className="py-3 text-slate-400">{SERVICE_LABEL[order.serviceType] ?? order.serviceType}</td>
      <td className="py-3"><StageBadge s={order.stage} /></td>
      <td className="py-3">
        {canWrite ? (
          <select
            aria-label={`Cambiar fase de la orden ${order.id}`}
            value={order.stage}
            disabled={update.isPending}
            onChange={(e) => changeStage(e.target.value)}
            className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
          >
            {REPAIR_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        ) : <span className="text-xs text-slate-500">—</span>}
      </td>
      <td className="py-3 text-right">
        {canWrite && <button aria-label={`Editar orden ${order.id}`} className="text-slate-400 hover:text-white" onClick={() => onEdit(order)}><Pencil className="w-4 h-4" /></button>}
      </td>
    </tr>
  );
}

// ── Página principal ─────────────────────────────────────────────────────────

export default function TallerPage() {
  const [stageFilter, setStageFilter] = useState<string>("");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<RepairOrder | "new" | null>(null);
  const { canWrite } = useTallerPermissions();

  const { data: dashboard, isLoading, isError, refetch } = useTallerDashboard();
  const { data: orders = [], isError: ordersError } = useRepairOrders({ stage: stageFilter || undefined, q: search });

  const safeData = dashboard ?? EMPTY_DASHBOARD;
  const filtered = stageFilter !== "" || search.trim() !== "";
  const newBtn = canWrite ? <button className={`${primaryBtn} inline-flex items-center gap-2`} onClick={() => setEditing("new")}><Plus className="w-4 h-4" /> Nueva orden</button> : null;

  return (
    <div className="min-h-screen bg-slate-900 p-4 md:p-6">
      <div className="max-w-6xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-orange-600/20 border border-orange-500/30 flex items-center justify-center">
              <Wrench className="w-5 h-5 text-orange-400" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-white">Omni Taller</h1>
              <p className="text-xs text-slate-400">Órdenes de reparación — citas y presupuestos en /calendar y /quotes</p>
            </div>
          </div>
          {newBtn}
        </div>

        {isError ? (
          <ErrorState onRetry={() => refetch()} />
        ) : isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4 h-[68px] animate-pulse" />
            ))}
          </div>
        ) : (
          <>
            {/* Stats */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <StatCard icon={Wrench}        label="Órdenes activas"      value={safeData.totalActive} />
              <StatCard icon={Clock}         label="En reparación"       value={safeData.inRepair} color="text-amber-400" />
              <StatCard icon={Package}       label="Esperando piezas"    value={safeData.waitingParts} color="text-orange-400" />
              <StatCard icon={CheckCircle2}  label="Listas para recoger" value={safeData.readyForPickup} color="text-emerald-400" />
            </div>

            {/* Órdenes */}
            <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
              <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
                <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <Wrench className="w-4 h-4 text-orange-400" /> Órdenes de reparación
                </h3>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
                    <input
                      aria-label="Buscar órdenes"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Matrícula, modelo o cliente"
                      className={`${inputCls} !w-56 !pl-8 !py-1.5 text-xs`}
                    />
                  </div>
                  <select
                    aria-label="Filtrar por fase"
                    value={stageFilter}
                    onChange={(e) => setStageFilter(e.target.value)}
                    className="bg-slate-700 border border-slate-600 rounded-lg px-2 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-orange-500"
                  >
                    <option value="">Todas las fases</option>
                    {REPAIR_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
                  </select>
                </div>
              </div>

              {ordersError ? (
                <p role="alert" className="text-sm text-red-400 py-6 text-center">No se pudieron cargar las órdenes.</p>
              ) : orders.length === 0 ? (
                <EmptyState
                  text={filtered ? "No hay órdenes que coincidan con la búsqueda." : "Todavía no hay órdenes de reparación. Crea la primera al recibir un vehículo."}
                  action={filtered ? null : newBtn}
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="border-b border-slate-700/50 text-slate-500 text-xs">
                        <th className="pb-2 font-medium">Cliente</th>
                        <th className="pb-2 font-medium">Vehículo</th>
                        <th className="pb-2 font-medium">Servicio</th>
                        <th className="pb-2 font-medium">Fase</th>
                        <th className="pb-2 font-medium">Cambiar a</th>
                        <th className="pb-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {orders.map((o) => <OrderRow key={o.id} order={o} canWrite={canWrite} onEdit={setEditing} />)}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </>
        )}
      </div>
      {editing && <OrderForm order={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
