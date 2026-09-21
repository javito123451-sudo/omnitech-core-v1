import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import {
  VEHICLE_STATUSES, VEHICLE_STATUS_LABEL, useCreateVehicle, useFleetDrivers, useFleetVehicles, useUpdateVehicle, type FleetVehicle,
} from "@/lib/fleet/fleetApi";
import { EmptyState, ErrorBanner, Field, Modal, StatusBadge, ghostBtn, inputCls, primaryBtn } from "./fleetUi";

const dateOnly = (v: string | null) => (v ? v.slice(0, 10) : "");

function VehicleForm({ vehicle, onClose }: { vehicle?: FleetVehicle; onClose: () => void }) {
  const create = useCreateVehicle();
  const update = useUpdateVehicle();
  const { data: drivers = [] } = useFleetDrivers();
  const [plate, setPlate] = useState(vehicle?.plate ?? "");
  const [model, setModel] = useState(vehicle?.model ?? "");
  const [driverId, setDriverId] = useState<string>(vehicle?.driverId ? String(vehicle.driverId) : "");
  const [odometerKm, setOdometer] = useState(vehicle?.odometerKm != null ? String(vehicle.odometerKm) : "");
  const [itv, setItv] = useState(dateOnly(vehicle?.itvExpiresAt ?? null));
  const [insurance, setInsurance] = useState(dateOnly(vehicle?.insuranceExpiresAt ?? null));
  const [status, setStatus] = useState(vehicle?.status ?? "available");
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    if (!vehicle && !plate.trim()) { setError("La matrícula es obligatoria."); return; }
    if (odometerKm && (!Number.isFinite(Number(odometerKm)) || Number(odometerKm) < 0)) { setError("Los kilómetros deben ser un número positivo."); return; }
    setError(null);
    const common = {
      model: model || undefined, driverId: driverId ? Number(driverId) : null,
      odometerKm: odometerKm ? Number(odometerKm) : undefined,
      itvExpiresAt: itv || undefined, insuranceExpiresAt: insurance || undefined, status,
    };
    try {
      if (vehicle) await update.mutateAsync({ id: vehicle.id, patch: common });
      else await create.mutateAsync({ plate: plate.trim(), ...common });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Modal title={vehicle ? `Editar ${vehicle.plate}` : "Nuevo vehículo"} onClose={onClose}>
      {!vehicle && <Field label="Matrícula" htmlFor="veh-plate"><input id="veh-plate" className={inputCls} value={plate} onChange={(e) => setPlate(e.target.value)} /></Field>}
      <Field label="Modelo" htmlFor="veh-model"><input id="veh-model" className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} /></Field>
      <Field label="Conductor habitual" htmlFor="veh-driver">
        <select id="veh-driver" className={inputCls} value={driverId} onChange={(e) => setDriverId(e.target.value)}>
          <option value="">Sin asignar</option>
          {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </Field>
      <Field label="Kilómetros" htmlFor="veh-km"><input id="veh-km" type="number" min="0" className={inputCls} value={odometerKm} onChange={(e) => setOdometer(e.target.value)} /></Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="ITV caduca" htmlFor="veh-itv"><input id="veh-itv" type="date" className={inputCls} value={itv} onChange={(e) => setItv(e.target.value)} /></Field>
        <Field label="Seguro caduca" htmlFor="veh-ins"><input id="veh-ins" type="date" className={inputCls} value={insurance} onChange={(e) => setInsurance(e.target.value)} /></Field>
      </div>
      <Field label="Estado" htmlFor="veh-status">
        <select id="veh-status" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          {VEHICLE_STATUSES.map((s) => <option key={s} value={s}>{VEHICLE_STATUS_LABEL[s]}</option>)}
        </select>
      </Field>
      <ErrorBanner message={error} />
      <div className="flex justify-end gap-2">
        <button className={ghostBtn} onClick={onClose}>Cancelar</button>
        <button className={primaryBtn} disabled={busy} onClick={submit}>{vehicle ? "Guardar" : "Crear vehículo"}</button>
      </div>
    </Modal>
  );
}

/** Caducidad próxima o vencida (30 días), para que ITV y seguro no pasen desapercibidos. */
function ExpiryCell({ value }: { value: string | null }) {
  if (!value) return <span className="text-slate-500">—</span>;
  const days = Math.floor((new Date(value).getTime() - Date.now()) / 86_400_000);
  const cls = days < 0 ? "text-red-400" : days <= 30 ? "text-amber-400" : "text-slate-400";
  return <span className={cls} title={days < 0 ? "Vencida" : `Caduca en ${days} días`}>{value.slice(0, 10)}{days < 0 ? " (vencida)" : ""}</span>;
}

export function VehiclesPanel({ canWrite }: { canWrite: boolean }) {
  const { data: vehicles = [], isLoading, isError } = useFleetVehicles();
  const { data: drivers = [] } = useFleetDrivers();
  const [editing, setEditing] = useState<FleetVehicle | "new" | null>(null);
  const driverName = (id: number | null) => drivers.find((d) => d.id === id)?.name ?? "Sin asignar";

  const addBtn = canWrite ? <button className={`${primaryBtn} inline-flex items-center gap-2`} onClick={() => setEditing("new")}><Plus className="w-4 h-4" /> Nuevo vehículo</button> : null;

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-300">Vehículos</h3>
        {vehicles.length > 0 && addBtn}
      </div>
      {isError ? <ErrorBanner message="No se pudieron cargar los vehículos." />
        : isLoading ? <p className="text-sm text-slate-500 py-6 text-center">Cargando…</p>
        : vehicles.length === 0 ? <EmptyState text="Todavía no hay vehículos. Añade el primero para asignarlo a rutas." action={addBtn} />
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-700/50 text-slate-500 text-xs">
                <th className="pb-2 font-medium">Matrícula</th><th className="pb-2 font-medium">Modelo</th><th className="pb-2 font-medium">Conductor</th>
                <th className="pb-2 font-medium">ITV</th><th className="pb-2 font-medium">Seguro</th><th className="pb-2 font-medium">Estado</th><th className="pb-2" />
              </tr></thead>
              <tbody>
                {vehicles.map((v) => (
                  <tr key={v.id} className="border-b border-slate-800">
                    <td className="py-3 font-medium text-slate-200">{v.plate}</td>
                    <td className="py-3 text-slate-400">{v.model ?? "—"}</td>
                    <td className="py-3 text-slate-400">{driverName(v.driverId)}</td>
                    <td className="py-3"><ExpiryCell value={v.itvExpiresAt} /></td>
                    <td className="py-3"><ExpiryCell value={v.insuranceExpiresAt} /></td>
                    <td className="py-3"><StatusBadge status={v.status} labels={VEHICLE_STATUS_LABEL} /></td>
                    <td className="py-3 text-right">
                      {canWrite && <button aria-label={`Editar ${v.plate}`} className="text-slate-400 hover:text-white" onClick={() => setEditing(v)}><Pencil className="w-4 h-4" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {editing && <VehicleForm vehicle={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
