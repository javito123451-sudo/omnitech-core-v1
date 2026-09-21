import { useState } from "react";
import { Plus, Pencil } from "lucide-react";
import {
  DRIVER_STATUSES, DRIVER_STATUS_LABEL, useCreateDriver, useFleetDrivers, useUpdateDriver, type FleetDriver,
} from "@/lib/fleet/fleetApi";
import { EmptyState, ErrorBanner, Field, Modal, StatusBadge, ghostBtn, inputCls, primaryBtn } from "./fleetUi";

function DriverForm({ driver, onClose }: { driver?: FleetDriver; onClose: () => void }) {
  const create = useCreateDriver();
  const update = useUpdateDriver();
  const [name, setName] = useState(driver?.name ?? "");
  const [phone, setPhone] = useState(driver?.phone ?? "");
  const [licenseNumber, setLicense] = useState(driver?.licenseNumber ?? "");
  const [status, setStatus] = useState(driver?.status ?? "available");
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    if (!name.trim()) { setError("El nombre es obligatorio."); return; }
    setError(null);
    try {
      if (driver) await update.mutateAsync({ id: driver.id, patch: { name: name.trim(), phone, licenseNumber, status } });
      else await create.mutateAsync({ name: name.trim(), phone: phone || undefined, licenseNumber: licenseNumber || undefined, status });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Modal title={driver ? "Editar conductor" : "Nuevo conductor"} onClose={onClose}>
      <Field label="Nombre" htmlFor="drv-name"><input id="drv-name" className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label="Teléfono" htmlFor="drv-phone"><input id="drv-phone" className={inputCls} value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
      <Field label="Nº de carnet" htmlFor="drv-license"><input id="drv-license" className={inputCls} value={licenseNumber} onChange={(e) => setLicense(e.target.value)} /></Field>
      <Field label="Estado" htmlFor="drv-status">
        <select id="drv-status" className={inputCls} value={status} onChange={(e) => setStatus(e.target.value)}>
          {DRIVER_STATUSES.map((s) => <option key={s} value={s}>{DRIVER_STATUS_LABEL[s]}</option>)}
        </select>
      </Field>
      <ErrorBanner message={error} />
      <div className="flex justify-end gap-2">
        <button className={ghostBtn} onClick={onClose}>Cancelar</button>
        <button className={primaryBtn} disabled={busy} onClick={submit}>{driver ? "Guardar" : "Crear conductor"}</button>
      </div>
    </Modal>
  );
}

export function DriversPanel({ canWrite }: { canWrite: boolean }) {
  const { data: drivers = [], isLoading, isError } = useFleetDrivers();
  const [editing, setEditing] = useState<FleetDriver | "new" | null>(null);

  const addBtn = canWrite ? <button className={`${primaryBtn} inline-flex items-center gap-2`} onClick={() => setEditing("new")}><Plus className="w-4 h-4" /> Nuevo conductor</button> : null;

  return (
    <div className="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-slate-300">Conductores</h3>
        {drivers.length > 0 && addBtn}
      </div>
      {isError ? <ErrorBanner message="No se pudieron cargar los conductores." />
        : isLoading ? <p className="text-sm text-slate-500 py-6 text-center">Cargando…</p>
        : drivers.length === 0 ? <EmptyState text="Todavía no hay conductores. Añade el primero para poder asignarle rutas." action={addBtn} />
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead><tr className="border-b border-slate-700/50 text-slate-500 text-xs">
                <th className="pb-2 font-medium">Nombre</th><th className="pb-2 font-medium">Teléfono</th>
                <th className="pb-2 font-medium">Carnet</th><th className="pb-2 font-medium">Estado</th><th className="pb-2" />
              </tr></thead>
              <tbody>
                {drivers.map((d) => (
                  <tr key={d.id} className="border-b border-slate-800">
                    <td className="py-3 font-medium text-slate-200">{d.name}</td>
                    <td className="py-3 text-slate-400">{d.phone ?? "—"}</td>
                    <td className="py-3 text-slate-400">{d.licenseNumber ?? "—"}</td>
                    <td className="py-3"><StatusBadge status={d.status} labels={DRIVER_STATUS_LABEL} /></td>
                    <td className="py-3 text-right">
                      {canWrite && <button aria-label={`Editar ${d.name}`} className="text-slate-400 hover:text-white" onClick={() => setEditing(d)}><Pencil className="w-4 h-4" /></button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      {editing && <DriverForm driver={editing === "new" ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
