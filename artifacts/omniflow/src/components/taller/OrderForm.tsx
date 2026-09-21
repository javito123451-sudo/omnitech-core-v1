// Alta y edición de una orden de reparación. Reutiliza las piezas de interfaz de Omni Fleet (mismo estilo).
import { useState } from "react";
import {
  REPAIR_STAGES, SERVICE_LABEL, SERVICE_TYPES, STAGE_LABEL, useCreateOrder, useTallerClients, useUpdateOrder, type RepairOrder,
} from "@/lib/taller/tallerApi";
import { ErrorBanner, Field, Modal, ghostBtn, inputCls, primaryBtn } from "@/components/fleet/fleetUi";

export function OrderForm({ order, onClose }: { order?: RepairOrder; onClose: () => void }) {
  const create = useCreateOrder();
  const update = useUpdateOrder();
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState<number | null>(order?.clientId ?? null);
  const [clientLabel, setClientLabel] = useState(order?.clientName ?? "");
  const { data: clients = [], isFetching } = useTallerClients(search, !order && search.trim().length >= 2);
  const [plate, setPlate] = useState(order?.vehiclePlate ?? "");
  const [model, setModel] = useState(order?.vehicleModel ?? "");
  const [km, setKm] = useState(order?.vehicleMileageKm != null ? String(order.vehicleMileageKm) : "");
  const [serviceType, setServiceType] = useState(order?.serviceType ?? "reparacion");
  const [stage, setStage] = useState(order?.stage ?? "received");
  const [notes, setNotes] = useState(order?.notes ?? "");
  const [error, setError] = useState<string | null>(null);
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    if (!order && clientId === null) { setError("Elige el cliente de la orden."); return; }
    if (km && (!/^\d+$/.test(km) || Number(km) > 5_000_000)) { setError("Los kilómetros deben ser un número entero positivo."); return; }
    setError(null);
    try {
      if (order) {
        await update.mutateAsync({ id: order.id, patch: { vehiclePlate: plate, vehicleModel: model, serviceType, notes, stage, ...(km ? { vehicleMileageKm: Number(km) } : {}) } });
      } else {
        await create.mutateAsync({
          clientId: clientId!, vehiclePlate: plate || undefined, vehicleModel: model || undefined,
          vehicleMileageKm: km ? Number(km) : undefined, serviceType, notes: notes || undefined,
        });
      }
      onClose();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Modal title={order ? `Editar orden #${order.id}` : "Nueva orden de reparación"} onClose={onClose}>
      {order ? (
        <p className="text-sm text-slate-300">Cliente: <span className="font-medium text-white">{order.clientName ?? "—"}</span></p>
      ) : clientId !== null ? (
        <div className="flex items-center justify-between bg-slate-700/50 rounded-lg px-3 py-2">
          <p className="text-sm text-slate-200">Cliente: <span className="font-medium">{clientLabel}</span></p>
          <button className="text-xs text-blue-400 hover:text-blue-300" onClick={() => { setClientId(null); setClientLabel(""); }}>Cambiar</button>
        </div>
      ) : (
        <Field label="Cliente" htmlFor="ord-client" hint="Escribe al menos 2 letras del nombre, teléfono o email.">
          <input id="ord-client" className={inputCls} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente…" />
          {search.trim().length >= 2 && (
            <ul className="mt-2 max-h-40 overflow-y-auto border border-slate-700 rounded-lg divide-y divide-slate-700">
              {isFetching && <li className="px-3 py-2 text-xs text-slate-500">Buscando…</li>}
              {!isFetching && clients.length === 0 && <li className="px-3 py-2 text-xs text-slate-500">Sin resultados. Crea el cliente primero desde el CRM.</li>}
              {clients.map((c) => (
                <li key={c.id}>
                  <button className="w-full text-left px-3 py-2 text-sm text-slate-200 hover:bg-slate-700" onClick={() => { setClientId(c.id); setClientLabel(c.name); }}>
                    {c.name}{c.phone ? <span className="text-slate-500"> · {c.phone}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Field>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="Matrícula" htmlFor="ord-plate"><input id="ord-plate" className={inputCls} value={plate} onChange={(e) => setPlate(e.target.value)} /></Field>
        <Field label="Modelo" htmlFor="ord-model"><input id="ord-model" className={inputCls} value={model} onChange={(e) => setModel(e.target.value)} /></Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Kilómetros" htmlFor="ord-km"><input id="ord-km" inputMode="numeric" className={inputCls} value={km} onChange={(e) => setKm(e.target.value)} /></Field>
        <Field label="Servicio" htmlFor="ord-service">
          <select id="ord-service" className={inputCls} value={serviceType} onChange={(e) => setServiceType(e.target.value)}>
            {SERVICE_TYPES.map((s) => <option key={s} value={s}>{SERVICE_LABEL[s]}</option>)}
          </select>
        </Field>
      </div>
      {order && (
        <Field label="Fase" htmlFor="ord-stage">
          <select id="ord-stage" className={inputCls} value={stage} onChange={(e) => setStage(e.target.value)}>
            {REPAIR_STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
          </select>
        </Field>
      )}
      <Field label="Notas" htmlFor="ord-notes"><textarea id="ord-notes" rows={3} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      <ErrorBanner message={error} />
      <div className="flex justify-end gap-2">
        <button className={ghostBtn} onClick={onClose}>Cancelar</button>
        <button className={primaryBtn} disabled={busy} onClick={submit}>{order ? "Guardar" : "Crear orden"}</button>
      </div>
    </Modal>
  );
}
