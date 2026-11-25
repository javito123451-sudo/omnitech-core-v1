/**
 * OmniCommerce Control — gestión comercial (Shopify → Omnitech-Core).
 * Solo muestra y pide acciones; el servidor valida rol, estado y pago (api: /api/commerce-control).
 * Aprobar / rechazar / pedir info / promo: solo SUPER_ADMIN (STAFF_OMNITECH solo lee).
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/hooks/use-toast";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { Link } from "wouter";
import { ShoppingBag, Loader2, CheckCircle2, XCircle, MessageSquareWarning, AlertTriangle } from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api/commerce-control`;

type Row = Record<string, any>;
const eur = (c: number | null | undefined) => (c == null ? "—" : (c / 100).toLocaleString("es-ES", { style: "currency", currency: "EUR" }));
const fmt = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—");

const TABS = [
  ["dashboard", "Dashboard"], ["captures", "Captación"], ["requests", "Activaciones"], ["orders", "Pedidos"], ["customers", "Clientes"],
  ["subscriptions", "Suscripciones"], ["billing", "Facturación"], ["products", "Productos"], ["integrations", "Integraciones"], ["audit", "Auditoría"],
] as const;
type Tab = (typeof TABS)[number][0];

const BADGE: Record<string, string> = {
  pending: "bg-amber-500/15 text-amber-400 border-amber-500/30", info_requested: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", rejected: "bg-red-500/10 text-red-400 border-red-500/30",
  cancelled: "bg-slate-500/15 text-slate-400 border-slate-500/30", paid: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  pending_payment: "bg-amber-500/15 text-amber-400 border-amber-500/30", active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  past_due: "bg-orange-500/15 text-orange-400 border-orange-500/30", suspended: "bg-red-500/10 text-red-400 border-red-500/30",
  refunded: "bg-red-500/10 text-red-400 border-red-500/30", partially_refunded: "bg-orange-500/15 text-orange-400 border-orange-500/30",
  disputed: "bg-red-500/10 text-red-400 border-red-500/30",
  new: "bg-amber-500/15 text-amber-400 border-amber-500/30", authorized: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  converted: "bg-violet-500/15 text-violet-300 border-violet-500/30", expired: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};
const Badge = ({ v }: { v: string }) => <span className={`text-xs px-2 py-0.5 rounded-full border ${BADGE[v] ?? "bg-slate-500/15 text-slate-300 border-slate-500/30"}`}>{v}</span>;

function useList(path: string, enabled = true) {
  return useQuery<any>({
    queryKey: ["commerce", path], enabled,
    queryFn: async () => { const r = await authFetch(`${API}${path}`); if (!r.ok) throw new Error("No se pudo cargar"); return r.json(); },
  });
}

function Table({ cols, rows, empty = "Sin datos" }: { cols: [string, (r: Row) => React.ReactNode][]; rows: Row[]; empty?: string }) {
  if (!rows.length) return <p className="text-sm text-slate-500 py-8 text-center">{empty}</p>;
  return (
    <div className="overflow-x-auto rounded-xl border border-white/10">
      <table className="w-full text-sm">
        <thead className="bg-white/5 text-slate-400 text-left"><tr>{cols.map(([h]) => <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => (
          <tr key={r.id ?? i} className="border-t border-white/5 text-slate-200">{cols.map(([h, f]) => <td key={h} className="px-3 py-2 whitespace-nowrap">{f(r)}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${warn ? "border-orange-500/30 bg-orange-500/5" : "border-white/10 bg-white/5"}`}>
      <div className="text-2xl font-bold text-white">{value}</div><div className="text-xs text-slate-400 mt-1">{label}</div>
    </div>
  );
}

function Dashboard() {
  const { data, isLoading } = useList("/dashboard");
  if (isLoading || !data) return <Loader2 className="w-5 h-5 animate-spin text-slate-400" />;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Stat label="Captaciones por revisar" value={data.new_captures} warn={data.new_captures > 0} />
      <Stat label="Autorizadas, pendientes de contratar" value={data.authorized_waiting_purchase} />
      <Stat label="Compras SIN autorización" value={data.unauthorized_purchases} warn={data.unauthorized_purchases > 0} />
      <Stat label="Pagadas, pendientes de activar" value={data.pending_activations} warn={data.pending_activations > 0} />
      <Stat label="Información solicitada" value={data.info_requested} />
      <Stat label="Pedidos pagados" value={data.paid_orders} />
      <Stat label="Pago pendiente" value={data.pending_payment_orders} />
      <Stat label="Suscripciones activas" value={data.active_subscriptions} />
      <Stat label="Con incidencia (impago/suspendidas)" value={data.incident_subscriptions} warn={data.incident_subscriptions > 0} />
      <Stat label="Cobrado últimos 30 días" value={eur(data.revenue_30d_cents)} />
      <Stat label="Webhooks fallidos" value={data.webhook_failures} warn={data.webhook_failures > 0} />
    </div>
  );
}

type Action = { kind: "approve" | "reject" | "info"; row: Row } | null;

function Requests({ canAct }: { canAct: boolean }) {
  const [status, setStatus] = useState("pending");
  const { data, isLoading } = useList(`/activation-requests?limit=200${status ? `&status=${status}` : ""}`);
  const [action, setAction] = useState<Action>(null);
  const [text, setText] = useState(""); const [company, setCompany] = useState(""); const [owner, setOwner] = useState("");
  const qc = useQueryClient(); const { toast } = useToast();

  const mut = useMutation({
    mutationFn: async () => {
      if (!action) return;
      const path = { approve: "approve", reject: "reject", info: "request-info" }[action.kind];
      const body = action.kind === "approve" ? { companyName: company || undefined, ownerEmail: owner || undefined }
        : action.kind === "reject" ? { reason: text } : { message: text };
      const r = await authFetch(`${API}/activation-requests/${action.row.id}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message ?? j.error ?? "Error");
      return j;
    },
    onSuccess: (j) => {
      qc.invalidateQueries({ queryKey: ["commerce"] });
      toast({ title: action?.kind === "approve" ? "Contratación aprobada" : action?.kind === "reject" ? "Solicitud rechazada" : "Información solicitada",
        description: action?.kind === "approve" && j && !j.welcomeEmailSent ? "Activada, pero el email de bienvenida NO se pudo enviar (revisa Resend)." : undefined,
        variant: action?.kind === "approve" && j && !j.welcomeEmailSent ? "destructive" : undefined });
      setAction(null); setText(""); setCompany(""); setOwner("");
    },
    onError: (e: Error) => toast({ title: "No se pudo completar", description: e.message, variant: "destructive" }),
  });

  const open = (kind: "approve" | "reject" | "info", row: Row) => { setAction({ kind, row }); setCompany(row.company ?? ""); setOwner(row.customer_email ?? ""); setText(""); };
  const actionable = (r: Row) => canAct && ["pending", "info_requested"].includes(r.status);

  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {[["pending", "Pendientes"], ["info_requested", "Info solicitada"], ["approved", "Activadas"], ["rejected", "Rechazadas"], ["", "Todas"]].map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} className={`px-3 py-1 rounded-lg text-xs border ${status === v ? "bg-violet-600 border-violet-500 text-white" : "border-white/10 text-slate-300"}`}>{l}</button>
        ))}
      </div>
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : (
        <Table rows={data ?? []} empty="No hay solicitudes en este estado" cols={[
          ["#", (r) => r.id], ["Cliente", (r) => r.customer_email ?? "—"], ["Empresa", (r) => r.company ?? "—"], ["Pedido", (r) => r.order_number ?? "—"],
          ["Pago", (r) => <Badge v={r.order_status} />], ["Autorización previa", (r) => (r.authorized ? <span className="text-emerald-400">Sí</span> : <span className="text-red-400">NO</span>)], ["Importe", (r) => eur(r.total_cents)], ["Plan", (r) => r.requested_plan ?? "—"],
          ["Estado", (r) => <Badge v={r.status} />], ["Fecha", (r) => fmt(r.created_at)],
          ["", (r) => (
            <span className="flex gap-1 items-center">
              {r.unmapped_items?.length > 0 && <span title="Hay líneas de pedido sin producto del catálogo"><AlertTriangle className="w-4 h-4 text-amber-400" /></span>}
              {actionable(r) && <>
                <button onClick={() => open("approve", r)} disabled={r.order_status !== "paid" || !r.authorized} title={!r.authorized ? "Sin autorización previa: no se puede activar" : r.order_status !== "paid" ? "Pago no confirmado" : "Activar"} className="p-1 text-emerald-400 disabled:opacity-30"><CheckCircle2 className="w-4 h-4" /></button>
                <button onClick={() => open("info", r)} title="Pedir información" className="p-1 text-sky-400"><MessageSquareWarning className="w-4 h-4" /></button>
                <button onClick={() => open("reject", r)} title="Rechazar" className="p-1 text-red-400"><XCircle className="w-4 h-4" /></button>
              </>}
            </span>
          )],
        ]} />
      )}
      {action && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setAction(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-xl p-5 w-full max-w-md space-y-3" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-semibold">{action.kind === "approve" ? "Activar contratación" : action.kind === "reject" ? "Rechazar solicitud" : "Solicitar información"}</h3>
            {action.kind === "approve" ? (<>
              <p className="text-xs text-slate-400">Se creará la empresa, el workspace y la licencia ({action.row.requested_plan}) y se enviará el acceso al propietario.</p>
              <input value={company} onChange={(e) => setCompany(e.target.value)} placeholder="Nombre de la empresa" className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white" />
              <input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="Email del propietario" className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white" />
            </>) : (
              <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={action.kind === "reject" ? "Motivo (obligatorio)" : "Mensaje para el cliente (obligatorio)"} className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white" />
            )}
            <div className="flex justify-end gap-2">
              <button onClick={() => setAction(null)} className="px-3 py-1.5 text-sm text-slate-300">Cancelar</button>
              <button onClick={() => mut.mutate()} disabled={mut.isPending || (action.kind !== "approve" && !text.trim())} className="px-3 py-1.5 text-sm rounded bg-violet-600 text-white disabled:opacity-40">
                {mut.isPending ? "Procesando…" : "Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


const MODULES = ["omni_tax","omni_accounting","omni_security","omni_docs","omni_diagnostics","integrations","omni_marketing","whatsapp","automations","omni_agent_factory","ai_agents","analytics","omni_import_ai","omni_leads","omni_ads","omni_seller"];
const PLANS = ["starter", "professional", "enterprise"];

function Captures({ canAct }: { canAct: boolean }) {
  const [status, setStatus] = useState("new");
  const { data, isLoading } = useList(`/capture-requests?limit=200${status ? `&status=${status}` : ""}`);
  const [sel, setSel] = useState<{ kind: "authorize" | "reject" | "info"; row: Row } | null>(null);
  const [plan, setPlan] = useState("starter"); const [mods, setMods] = useState<string[]>([]); const [days, setDays] = useState(14); const [text, setText] = useState("");
  const qc = useQueryClient(); const { toast } = useToast();
  const mut = useMutation({
    mutationFn: async () => {
      if (!sel) return;
      const path = { authorize: "authorize", reject: "reject", info: "request-info" }[sel.kind];
      const body = sel.kind === "authorize" ? { plan, modules: mods, validDays: days } : sel.kind === "reject" ? { reason: text } : { message: text };
      const r = await authFetch(`${API}/capture-requests/${sel.row.id}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.message ?? j.error ?? "Error"); return j;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["commerce"] }); toast({ title: sel?.kind === "authorize" ? "Contratación autorizada" : "Hecho" }); setSel(null); setText(""); setMods([]); },
    onError: (e: Error) => toast({ title: "No se pudo completar", description: e.message, variant: "destructive" }),
  });
  const open = (kind: "authorize" | "reject" | "info", row: Row) => { setSel({ kind, row }); setPlan(row.plan_interest ?? "starter"); setMods(row.modules_interest ?? []); setText(""); };
  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-400">Primero se capta; el cliente no puede contratar hasta que lo autorizas aquí. Después de pagar, lo activas en la pestaña Activaciones.</p>
      <div className="flex gap-2 flex-wrap">
        {[["new", "Nuevas"], ["info_requested", "Info solicitada"], ["authorized", "Autorizadas"], ["converted", "Activadas"], ["rejected", "Rechazadas"], ["expired", "Caducadas"], ["", "Todas"]].map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} className={`px-3 py-1 rounded-lg text-xs border ${status === v ? "bg-violet-600 border-violet-500 text-white" : "border-white/10 text-slate-300"}`}>{l}</button>))}
      </div>
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : (
        <Table rows={data ?? []} empty="No hay captaciones en este estado" cols={[
          ["#", (r) => r.id], ["Email", (r) => r.email], ["Nombre", (r) => r.name], ["Empresa", (r) => r.company ?? "—"], ["Interés", (r) => r.plan_interest ?? "—"],
          ["Mensaje", (r) => <span title={r.message ?? ""}>{(r.message ?? "—").slice(0, 40)}</span>], ["Estado", (r) => <Badge v={r.status} />],
          ["Autorizado", (r) => (r.status === "authorized" ? `${r.authorized_plan} hasta ${fmt(r.authorized_until)}` : "—")], ["Fecha", (r) => fmt(r.created_at)],
          ["", (r) => canAct && ["new", "info_requested", "authorized"].includes(r.status) ? (
            <span className="flex gap-1">
              <button onClick={() => open("authorize", r)} title="Autorizar contratación" className="p-1 text-emerald-400"><CheckCircle2 className="w-4 h-4" /></button>
              <button onClick={() => open("info", r)} title="Pedir información" className="p-1 text-sky-400"><MessageSquareWarning className="w-4 h-4" /></button>
              <button onClick={() => open("reject", r)} title="Rechazar" className="p-1 text-red-400"><XCircle className="w-4 h-4" /></button>
            </span>) : null],
        ]} />)}
      {sel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setSel(null)}>
          <div className="bg-slate-900 border border-white/10 rounded-xl p-5 w-full max-w-md space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-white font-semibold">{sel.kind === "authorize" ? "Autorizar contratación" : sel.kind === "reject" ? "Rechazar captación" : "Solicitar información"} · {sel.row.email}</h3>
            {sel.kind === "authorize" ? (<>
              <label className="block text-xs text-slate-400">Plan autorizado
                <select value={plan} onChange={(e) => setPlan(e.target.value)} className="mt-1 w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white">{PLANS.map((p) => <option key={p}>{p}</option>)}</select></label>
              <label className="block text-xs text-slate-400">Vigencia de la autorización (días)
                <input type="number" min={1} max={90} value={days} onChange={(e) => setDays(Number(e.target.value))} className="mt-1 w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white" /></label>
              <div className="text-xs text-slate-400">Módulos a incorporar al activar
                <div className="grid grid-cols-2 gap-1 mt-1">{MODULES.map((m) => (
                  <label key={m} className="flex gap-1 items-center text-slate-200"><input type="checkbox" checked={mods.includes(m)} onChange={(e) => setMods(e.target.checked ? [...mods, m] : mods.filter((x) => x !== m))} />{m}</label>))}</div></div>
            </>) : <textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} placeholder={sel.kind === "reject" ? "Motivo (obligatorio)" : "Mensaje para el cliente (obligatorio)"} className="w-full bg-slate-800 border border-white/10 rounded px-3 py-2 text-sm text-white" />}
            <div className="flex justify-end gap-2">
              <button onClick={() => setSel(null)} className="px-3 py-1.5 text-sm text-slate-300">Cancelar</button>
              <button onClick={() => mut.mutate()} disabled={mut.isPending || (sel.kind !== "authorize" && !text.trim())} className="px-3 py-1.5 text-sm rounded bg-violet-600 text-white disabled:opacity-40">{mut.isPending ? "Procesando…" : "Confirmar"}</button>
            </div>
          </div>
        </div>)}
    </div>
  );
}

function Products({ canAct }: { canAct: boolean }) {
  const { data, isLoading } = useList("/products");
  const qc = useQueryClient(); const { toast } = useToast();
  const promo = useMutation({
    mutationFn: async ({ id, active }: { id: number; active: boolean }) => {
      const r = await authFetch(`${API}/products/${id}/promo`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ active }) });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Error");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commerce"] }),
    onError: (e: Error) => toast({ title: "No se pudo cambiar la promoción", description: e.message, variant: "destructive" }),
  });
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-slate-400" />;
  return <Table rows={data ?? []} cols={[
    ["Código", (r) => r.code], ["Nombre", (r) => r.name], ["Tipo", (r) => r.kind], ["Plan", (r) => r.plan ?? "—"],
    ["Precio/mes (sin IVA)", (r) => r.promo_active && r.promo_price_cents != null ? <span>{eur(r.promo_price_cents)} <s className="text-slate-500">{eur(r.list_price_cents)}</s></span> : eur(r.list_price_cents)],
    ["Venta en tienda", (r) => (r.sellable ? "Sí" : "No (se incorpora según necesidad)")],
    ["Promo lanzamiento", (r) => r.promo_price_cents == null ? "—" : (
      <label className="flex items-center gap-2"><input type="checkbox" checked={!!r.promo_active} disabled={!canAct || promo.isPending} onChange={(e) => promo.mutate({ id: r.id, active: e.target.checked })} />{eur(r.promo_price_cents)}</label>)],
  ]} />;
}

function Integrations() {
  const { data, isLoading } = useList("/integrations");
  if (isLoading || !data) return <Loader2 className="w-5 h-5 animate-spin text-slate-400" />;
  const ok = (b: boolean) => <span className={b ? "text-emerald-400" : "text-red-400"}>{b ? "Configurado" : "Falta"}</span>;
  return (
    <div className="space-y-4 text-sm text-slate-200">
      <div className="rounded-xl border border-white/10 p-4 space-y-1">
        <div>Shopify · secreto de webhooks: {ok(data.shopify.apiSecretConfigured)}</div>
        <div>Shopify · dominio de tienda: {ok(data.shopify.shopDomainConfigured)}</div>
        <div>Shopify · token de administración: {ok(data.shopify.adminTokenConfigured)}</div>
        <div>Email (Resend): {ok(data.email.resendConfigured)}</div>
      </div>
      <div className="rounded-xl border border-white/10 p-4">
        <div className="text-slate-400 mb-1">Eventos de webhook por estado</div>
        {Object.entries(data.webhookEvents).map(([k, v]) => <div key={k}>{k}: {String(v)}</div>)}
        {!Object.keys(data.webhookEvents).length && <div className="text-slate-500">Aún no se ha recibido ningún evento</div>}
      </div>
      <div className="rounded-xl border border-white/10 p-4">
        <div className="text-slate-400 mb-1">Política de suspensión / reactivación</div>
        <div>Periodo de gracia: {data.policy.graceDays} días · Suspender tras {data.policy.suspendAfterFailedAttempts} impagos</div>
        <div>Reembolso total suspende: {data.policy.suspendOnFullRefund ? "sí" : "no"} · Contracargo suspende: {data.policy.suspendOnChargeback ? "sí" : "no"} · Reactivar al pagar: {data.policy.autoReactivateOnPayment ? "sí" : "no"}</div>
      </div>
    </div>
  );
}

export default function CommercePage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  const { isSuperAdmin } = useSuperAdmin();
  const orders = useList("/orders?limit=100", tab === "orders");
  const customers = useList("/customers?limit=100", tab === "customers");
  const subs = useList("/subscriptions?limit=100", tab === "subscriptions");
  const billing = useList("/billing?limit=100", tab === "billing");
  const audit = useList("/audit?limit=100", tab === "audit");

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-1"><ShoppingBag className="w-6 h-6 text-violet-400" /><h1 className="text-xl font-bold text-white">OmniCommerce Control</h1></div>
      <p className="text-sm text-slate-400 mb-4">Pedidos de Shopify, solicitudes de activación y suscripciones. Primero se capta y un administrador autoriza; solo entonces el cliente puede contratar, y la licencia se activa a mano tras el pago.
        {" "}<Link href="/control-center/licenses" className="text-violet-400 underline">Ver licencias</Link></p>
      {!isSuperAdmin && <p className="text-xs text-amber-400 mb-3">Modo solo lectura: aprobar, rechazar y editar promociones requiere SUPER_ADMIN.</p>}
      <div className="flex gap-1 flex-wrap mb-5 border-b border-white/10 pb-2">
        {TABS.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-sm ${tab === k ? "bg-violet-600 text-white" : "text-slate-300 hover:bg-white/5"}`}>{l}</button>)}
      </div>
      {tab === "dashboard" && <Dashboard />}
      {tab === "captures" && <Captures canAct={isSuperAdmin} />}
      {tab === "requests" && <Requests canAct={isSuperAdmin} />}
      {tab === "orders" && <Table rows={orders.data ?? []} cols={[["Pedido", (r) => r.order_number ?? r.shopify_order_id], ["Cliente", (r) => r.customer_email ?? r.email ?? "—"], ["Empresa", (r) => r.company ?? "—"], ["Estado", (r) => <Badge v={r.order_status} />], ["Total", (r) => eur(r.total_cents)], ["Reembolsado", (r) => eur(r.refunded_cents)], ["Fecha", (r) => fmt(r.created_at)]]} />}
      {tab === "customers" && <Table rows={customers.data ?? []} cols={[["Email", (r) => r.email ?? "(anonimizado)"], ["Nombre", (r) => [r.first_name, r.last_name].filter(Boolean).join(" ") || "—"], ["Empresa", (r) => r.company ?? "—"], ["Workspace", (r) => r.org_id ?? "—"], ["Marketing", (r) => (r.marketing_consent ? "Consentido" : "No")], ["Alta", (r) => fmt(r.created_at)]]} />}
      {tab === "subscriptions" && <Table rows={subs.data ?? []} cols={[["Cliente", (r) => r.customer_email ?? "—"], ["Plan", (r) => r.plan ?? "—"], ["Estado", (r) => <Badge v={r.status} />], ["Fallos", (r) => r.failed_attempts], ["Gracia hasta", (r) => fmt(r.grace_until)], ["Próx. periodo", (r) => fmt(r.current_period_end)], ["Motivo", (r) => r.suspend_reason ?? "—"], ["Workspace", (r) => r.org_id ?? "—"]]} />}
      {tab === "billing" && <Table rows={billing.data ?? []} cols={[["Fecha", (r) => fmt(r.occurred_at)], ["Evento", (r) => r.event_type], ["Importe", (r) => eur(r.amount_cents)], ["Referencia", (r) => r.shopify_ref]]} />}
      {tab === "products" && <Products canAct={isSuperAdmin} />}
      {tab === "integrations" && <Integrations />}
      {tab === "audit" && <Table rows={audit.data ?? []} cols={[["Fecha", (r) => fmt(r.created_at)], ["Actor", (r) => r.actor], ["Acción", (r) => r.action], ["De → a", (r) => `${r.from_status ?? "—"} → ${r.to_status ?? "—"}`], ["Solicitud", (r) => r.activation_request_id ?? "—"], ["Suscripción", (r) => r.subscription_id ?? "—"]]} />}
    </div>
  );
}
