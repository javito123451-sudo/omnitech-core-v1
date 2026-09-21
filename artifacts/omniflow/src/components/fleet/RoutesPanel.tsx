import { useState } from "react";
import { ChevronDown, ChevronRight, Plus } from "lucide-react";
import {
  DELIVERY_STATUSES, DELIVERY_STATUS_LABEL, ROUTE_STATUSES, ROUTE_STATUS_LABEL,
  useAddDelivery, useCreateRoute, useFleetDeliveries, useFleetDrivers, useFleetRoutes, useFleetVehicles, useUpdateDelivery, useUpdateRoute,
  type FleetRoute,
} from "@/lib/fleet/fleetApi";
import { EmptyState, ErrorBanner, Field, Modal, StatusBadge, ghostBtn, inputCls, primaryBtn } from "./fleetUi";

const today = () => new Date().toISOString().slice(0, 10);

function RouteForm({ defaultDate, onClose }: { defaultDate: string; onClose: () => void }) {
  const create = useCreateRoute();
  const { data: drivers = [] } = useFleetDrivers();
  const { data: vehicles = [] } = useFleetVehicles();
  const [name, setName] = useState("");
  const [date, setDate] = useState(defaultDate);
  const [driverId, setDriverId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!name.trim() || !date) { setError("La ruta necesita nombre y fecha."); return; }
    setError(null);
    try {
      await create.mutateAsync({ name: name.trim(), date, driverId: driverId ? Number(driverId) : null, vehicleId: vehicleId ? Number(vehicleId) : null });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Modal title="Nueva ruta" onClose={onClose}>
      <Field label="Nombre" htmlFor="rt-name"><input id="rt-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} placeholder="Ej. Reparto zona norte" /></Field>
      <Field label="Fecha" htmlFor="rt-date"><input id="rt-date" type="date" className={inputCls} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
      <Field label="Conductor" htmlFor="rt-driver">
        <select id="rt-driver" className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Sin asignar</option>
          {drivers.filter((d) => d.status !== "inactive").map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <Field label="Vehículo" htmlFor="rt-vehicle">
        <select id="rt-vehicle" className={inputCls} value={vehicleId} onChange={(e) => setVehicleId(e.target.value)}>
          <option value="">Sin asignar</option>
          {vehicles.filter((v) => v.status !== "inactive").map((v) => <option key={v.id} value={v.id}>{v.plate}{v.model ? ` · ${v.model}` : ""}</option>)}
        </select>
      </Field>
      <ErrorBanner message={error} />
      <div className="flex justify-end gap-2">
        <button className={ghostBtn} onClick={onClose}>Cancelar</button>
        <button className={primaryBtn} disabled={create.isPending} onClick={submit}>Crear ruta</button>
      </div>
    </Modal>
  );
}

function Deliveries({ route, canWrite }: { route: FleetRoute; canWrite: boolean }) {
  const { data: deliveries = [], isLoading, isError } = useFleetDeliveries(route.id);
  const add = useAddDelivery();
  const update = useUpdateDelivery();
  const [address, setAddress] = useState("");
  const [recipient, setRecipient] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);

  const addDelivery = async () => {
    if (!address.trim()) { setError("Indica la dirección de la entrega."); return; }
    setError(null);
    try {
      await add.mutateAsync({ routeId: route.id, body: { address: address.trim(), recipientName: recipient || undefined, recipientPhone: phone || undefined } });
      setAddress(""); setRecipient(""); setPhone("");
    } catch (e) { setError((e as Error).message); }
  };
  const changeStatus = async (id: number, status: string) => {
    setError(null);
    try { await update.mutateAsync({ routeId: route.id, id, patch: { status } }); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="bg-slate-900/40 rounded-lg p-4 space-y-3">
      {isError ? <ErrorBanner message="No se pudieron cargar las entregas." />
        : isLoading ? <p className="text-sm text-slate-500">Cargando…</p>
        : deliveries.length === 0 ? <p className="text-sm text-slate-500">Esta ruta todavía no tiene entregas.</p>
        : (
          <ul className="space-y-2">
            {deliveries.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 text-sm">
                <div className="flex-1 min-w-[12rem]">
                  <p className="text-slate-200">{d.address ?? d.externalDeliveryId ?? `Entrega #${d.id}`}</p>
                  <p className="text-xs text-slate-500">{[d.recipientName, d.recipientPhone].filter(Boolean).join(" · ") || "Sin destinatario"}{d.lastStatusNote ? ` — ${d.lastStatusNote}` : ""}</p>
                </div>
                {canWrite ? (
                  <select aria-label={`Estado de la entrega ${d.id}`} className={`${inputCls} !w-auto`} value={d.status} disabled={update.isPending} onChange={(e) => changeStatus(d.id, e.target.value)}>
                    {DELIVERY_STATUSES.map((s) => <option key={s} value={s}>{DELIVERY_STATUS_LABEL[s]}</option>)}
                  </select>
                ) : <StatusBadge status={d.status} labels={DELIVERY_STATUS_LABEL} />}
              </li>
            ))}
          </ul>
        )}
      {canWrite && (
        <div className="grid gap-2 md:grid-cols-[2fr_1fr_1fr_auto] pt-2 border-t border-slate-700/50">
          <input aria-label="Dirección de la entrega" className={inputCls} placeholder="Dirección" value={address} onChange={(e) => setAddress(e.target.value)} />
          <input aria-label="Destinatario" className={inputCls} placeholder="Destinatario" value={recipient} onChange={(e) => setRecipient(e.target.value)} />
          <input aria-label="Teléfono del destinatario" className={inputCls} placeholder="Teléfono" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className={primaryBtn} disabled={add.isPending} onClick={addDelivery}>Añadir entrega</button>
        </div>
      )}
      <ErrorBanner message={error} />
    </div>
  );
}

export function RoutesPanel({ canWrite }: { canWrite: boolean }) {
  const [date, setDate] = useState(today());
  const [showAll, setShowAll] = useState(false);
  const { data: routes = [], isLoading, isError } = useFleetRoutes(showAll ? undefined : date);
  const { data: drivers = [] } = useFleetDrivers();
  const { data: vehicles = [] } = useFleetVehicles();
  const updateRoute = useUpdateRoute();
  const [open, setOpen] = useState<number | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const driverName = (id: number | null) => drivers.find((d) => d.id === id)?.name ?? "Sin asignar";
  const vehiclePlate = (id: number | null) => vehicles.find((v) => v.id === id)?.plate ?? "Sin asignar";
  const setStatus = async (id: number, status: string) => {
    setError(null);
    try { await updateRoute.mutateAsync({ id, patch: { status } }); } catch (e) { setError((e as Error).message); }
  };

  const addBtn = canWrite ? <button className={`${primaryBtn} inline-flex items-center gap-2`} onClick={() => setCreating(true)}><Plus className="w-4 h-4" /> Nueva ruta</button> : null;

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-3 justify-between">
        <h3 className="text-sm font-semibold text-slate-300">Rutas</h3>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-slate-400">
            <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Todas las fechas
          </label>
          {!showAll && <input aria-label="Fecha de las rutas" type="date" className={`${inputCls} !w-auto`} value={date} onChange={(e) => setDate(e.target.value)} />}
          {addBtn}
        </div>
      </div>
      <ErrorBanner message={error} />
      {isError ? <ErrorBanner message="No se pudieron cargar las rutas." />
        : isLoading ? <p className="text-sm text-slate-500 py-6 text-center">Cargando…</p>
        : routes.length === 0 ? <EmptyState text={showAll ? "Todavía no hay rutas." : "No hay rutas para esta fecha."} action={addBtn} />
        : (
          <ul className="space-y-2">
            {routes.map((r) => (
              <li key={r.id} className="border border-slate-700/50 rounded-lg">
                <div className="flex flex-wrap items-center gap-3 p-3">
                  <button aria-label={open === r.id ? `Ocultar entregas de ${r.name}` : `Ver entregas de ${r.name}`} className="text-slate-400 hover:text-white" onClick={() => setOpen(open === r.id ? null : r.id)}>
                    {open === r.id ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                  </button>
                  <div className="flex-1 min-w-[10rem]">
                    <p className="font-medium text-slate-200">{r.name}</p>
                    <p className="text-xs text-slate-500">{r.date.slice(0, 10)} · {driverName(r.driverId)} · {vehiclePlate(r.vehicleId)}</p>
                  </div>
                  <p className="text-sm text-slate-300">{r.completedStops} / {r.totalStops} entregas{r.incidentStops > 0 && <span className="text-amber-400"> · {r.incidentStops} incid.</span>}</p>
                  {canWrite ? (
                    <select aria-label={`Estado de la ruta ${r.name}`} className={`${inputCls} !w-auto`} value={r.status} disabled={updateRoute.isPending} onChange={(e) => setStatus(r.id, e.target.value)}>
                      {ROUTE_STATUSES.map((s) => <option key={s} value={s}>{ROUTE_STATUS_LABEL[s]}</option>)}
                    </select>
                  ) : <StatusBadge status={r.status} labels={ROUTE_STATUS_LABEL} />}
                </div>
                {open === r.id && <div className="px-3 pb-3"><Deliveries route={r} canWrite={canWrite} /></div>}
              </li>
            ))}
          </ul>
        )}
      {creating && <RouteForm defaultDate={date} onClose={() => setCreating(false)} />}
    </div>
  );
}
