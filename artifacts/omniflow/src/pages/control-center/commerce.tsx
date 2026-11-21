// OmniCommerce Control — pedidos, suscripciones y activación manual de licencias.
// Toda la lógica de decisión está en el servidor: aquí solo se consulta y se piden acciones.
import { Fragment, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  ShoppingBag, Inbox, Receipt, Users, Repeat, Wallet, Package, Plug, ClipboardList,
  Check, X, HelpCircle, Loader2, RefreshCw, AlertTriangle, Key, FlaskConical,
} from "lucide-react";
import { authFetch } from "@/lib/authFetch";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const API = `${BASE}/api/control-center/commerce`;

async function getJson<T>(path: string): Promise<T> {
  const r = await authFetch(`${API}${path}`);
  if (!r.ok) throw new Error((await r.json().catch(() => ({})))?.error ?? `HTTP ${r.status}`);
  return r.json();
}
async function postJson<T>(path: string, body: unknown, method = "POST"): Promise<T> {
  const r = await authFetch(`${API}${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data?.error ?? `HTTP ${r.status}`);
  return data as T;
}

const eur = (v: string | number | null | undefined, cur = "EUR") =>
  v == null || v === "" ? "—" : new Intl.NumberFormat("es-ES", { style: "currency", currency: cur }).format(Number(v));
const fdate = (d: string | null | undefined) => (d ? new Date(d).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }) : "—");

const STATUS_STYLE: Record<string, string> = {
  pending_payment: "bg-slate-500/20 text-slate-300", pending_review: "bg-amber-500/20 text-amber-300",
  info_requested: "bg-blue-500/20 text-blue-300", approved: "bg-emerald-500/20 text-emerald-300",
  activated: "bg-emerald-500/20 text-emerald-300", rejected: "bg-rose-500/20 text-rose-300", failed: "bg-rose-500/20 text-rose-300",
  paid: "bg-emerald-500/20 text-emerald-300", pending: "bg-slate-500/20 text-slate-300", authorized: "bg-blue-500/20 text-blue-300",
  refunded: "bg-rose-500/20 text-rose-300", partially_refunded: "bg-amber-500/20 text-amber-300", voided: "bg-rose-500/20 text-rose-300",
  active: "bg-emerald-500/20 text-emerald-300", grace: "bg-amber-500/20 text-amber-300", past_due: "bg-amber-500/20 text-amber-300",
  suspended: "bg-rose-500/20 text-rose-300", cancelled: "bg-slate-500/20 text-slate-400", expired: "bg-slate-500/20 text-slate-400",
  processed: "bg-emerald-500/20 text-emerald-300", ignored: "bg-slate-500/20 text-slate-400", received: "bg-blue-500/20 text-blue-300",
  charge: "bg-emerald-500/20 text-emerald-300", renewal: "bg-emerald-500/20 text-emerald-300", failed_payment: "bg-amber-500/20 text-amber-300",
  refund: "bg-rose-500/20 text-rose-300", chargeback: "bg-rose-500/20 text-rose-300",
};
const STATUS_LABEL: Record<string, string> = {
  pending_payment: "Pago pendiente", pending_review: "Pendiente de aprobación", info_requested: "Info solicitada",
  activated: "Activada", rejected: "Rechazada", failed: "Error", approved: "Aprobada",
  grace: "En gracia", past_due: "Impago", suspended: "Suspendida", cancelled: "Cancelada", expired: "Expirada", active: "Activa",
  paid: "Pagado", pending: "Pendiente", refunded: "Reembolsado", partially_refunded: "Reembolso parcial",
  charge: "Cobro", renewal: "Renovación", failed_payment: "Cobro fallido", refund: "Reembolso", chargeback: "Contracargo",
};
function Badge({ s }: { s: string }) {
  return <span className={cn("px-2 py-0.5 rounded-md text-xs font-medium whitespace-nowrap", STATUS_STYLE[s] ?? "bg-slate-500/20 text-slate-300")}>{STATUS_LABEL[s] ?? s}</span>;
}

type Tab = "dashboard" | "requests" | "orders" | "customers" | "subscriptions" | "billing" | "products" | "integrations" | "audit";
const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "dashboard", label: "Dashboard", icon: ShoppingBag },
  { id: "requests", label: "Solicitudes", icon: Inbox },
  { id: "orders", label: "Pedidos", icon: Receipt },
  { id: "customers", label: "Clientes", icon: Users },
  { id: "subscriptions", label: "Suscripciones", icon: Repeat },
  { id: "billing", label: "Facturación", icon: Wallet },
  { id: "products", label: "Productos", icon: Package },
  { id: "integrations", label: "Integraciones", icon: Plug },
  { id: "audit", label: "Activaciones", icon: ClipboardList },
];

export default function CommerceControlPage() {
  const [tab, setTab] = useState<Tab>("dashboard");
  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white">OmniCommerce Control</h1>
          <p className="text-sm text-slate-400">Pedidos de Shopify, suscripciones y activación manual. Ninguna compra activa una licencia sin tu aprobación.</p>
        </div>
        <Link href={`${BASE}/control-center/licenses`}>
          <span className="inline-flex items-center gap-2 text-sm text-slate-300 hover:text-white cursor-pointer"><Key className="w-4 h-4" /> Licencias</span>
        </Link>
      </div>
      <div className="flex gap-1 overflow-x-auto border-b border-white/10">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={cn("flex items-center gap-2 px-3 py-2 text-sm whitespace-nowrap border-b-2 -mb-px",
              tab === t.id ? "border-blue-500 text-white" : "border-transparent text-slate-400 hover:text-white")}>
            <t.icon className="w-4 h-4" />{t.label}
          </button>
        ))}
      </div>
      {tab === "dashboard" && <DashboardTab onGo={setTab} />}
      {tab === "requests" && <RequestsTab />}
      {tab === "orders" && <SimpleTable path="/orders" filterKey="financialStatus" filters={["all", "paid", "pending", "refunded", "partially_refunded"]}
        cols={[["Pedido", (r) => r.order.orderNumber ?? r.order.externalOrderId], ["Cliente", (r) => r.companyName ?? r.customerEmail ?? "—"],
          ["Importe", (r) => eur(r.order.totalAmount, r.order.currency)], ["Pago", (r) => <Badge s={r.order.financialStatus} />],
          ["Estado", (r) => <Badge s={r.order.orderStatus} />], ["Prueba", (r) => (r.order.isTest ? <FlaskConical className="w-4 h-4 text-amber-400" /> : "")],
          ["Fecha", (r) => fdate(r.order.createdAt)]]} />}
      {tab === "customers" && <SimpleTable path="/customers" search
        cols={[["Empresa", (r) => r.companyName ?? "—"], ["Nombre", (r) => r.name ?? "—"], ["Email", (r) => r.email ?? "—"],
          ["NIF", (r) => r.taxId ?? "—"], ["Workspace", (r) => (r.orgId ? `#${r.orgId}` : "—")], ["Alta", (r) => fdate(r.createdAt)]]} />}
      {tab === "subscriptions" && <SimpleTable path="/subscriptions" filterKey="status" filters={["all", "active", "grace", "past_due", "suspended", "cancelled"]}
        cols={[["Cliente", (r) => r.companyName ?? r.customerEmail ?? "—"], ["Producto", (r) => r.productName ?? "—"],
          ["Estado", (r) => <Badge s={r.subscription.status} />], ["Workspace", (r) => r.orgName ?? "—"],
          ["Último pago", (r) => fdate(r.subscription.lastPaymentAt)], ["Fallos", (r) => r.subscription.failedPaymentCount],
          ["Gracia hasta", (r) => fdate(r.subscription.graceUntil)]]} />}
      {tab === "billing" && <SimpleTable path="/billing" filterKey="kind" filters={["all", "charge", "renewal", "failed_payment", "refund", "chargeback"]}
        cols={[["Tipo", (r) => <Badge s={r.kind} />], ["Importe", (r) => eur(r.amount, r.currency)], ["Referencia", (r) => r.externalTransactionId],
          ["Workspace", (r) => (r.orgId ? `#${r.orgId}` : "—")], ["Fecha", (r) => fdate(r.occurredAt)]]} />}
      {tab === "products" && <ProductsTab />}
      {tab === "integrations" && <IntegrationsTab />}
      {tab === "audit" && <SimpleTable path="/activations"
        cols={[["Solicitud", (r) => `#${r.activationRequestId}`], ["Acción", (r) => r.action], ["De → a", (r) => `${r.fromStatus ?? "—"} → ${r.toStatus ?? "—"}`],
          ["Actor", (r) => r.actorClerkId ?? "sistema"], ["Fecha", (r) => fdate(r.createdAt)]]} />}
    </div>
  );
}

// ── Dashboard ────────────────────────────────────────────────────────────────
interface Dash {
  activationRequests: Record<string, number>; subscriptions: Record<string, number>; orders: Record<string, number>;
  failedWebhooks: number; monthToDate: Record<string, string>;
  integration: { webhookSecretConfigured: boolean; shopDomain: string | null; adminApiConfigured: boolean };
}
function DashboardTab({ onGo }: { onGo: (t: Tab) => void }) {
  const { data, isLoading, error } = useQuery<Dash>({ queryKey: ["commerce-dash"], queryFn: () => getJson("/dashboard"), refetchInterval: 30_000 });
  if (isLoading) return <Loader2 className="w-5 h-5 animate-spin text-slate-400" />;
  if (error || !data) return <p className="text-rose-400 text-sm">{String((error as Error)?.message ?? "Error")}</p>;
  const a = data.activationRequests, s = data.subscriptions;
  const kpis = [
    { label: "Pendientes de aprobación", value: (a["pending_review"] ?? 0) + (a["info_requested"] ?? 0), tone: "text-amber-300", go: "requests" as Tab },
    { label: "Esperando pago", value: a["pending_payment"] ?? 0, tone: "text-slate-200", go: "requests" as Tab },
    { label: "Suscripciones activas", value: s["active"] ?? 0, tone: "text-emerald-300", go: "subscriptions" as Tab },
    { label: "Con incidencias de pago", value: (s["grace"] ?? 0) + (s["past_due"] ?? 0) + (s["suspended"] ?? 0), tone: "text-rose-300", go: "subscriptions" as Tab },
    { label: "Cobrado este mes", value: eur(Number(data.monthToDate["charge"] ?? 0) + Number(data.monthToDate["renewal"] ?? 0)), tone: "text-white", go: "billing" as Tab },
    { label: "Webhooks con error", value: data.failedWebhooks, tone: data.failedWebhooks ? "text-rose-300" : "text-slate-200", go: "integrations" as Tab },
  ];
  const integ = data.integration;
  return (
    <div className="space-y-4">
      {(!integ.webhookSecretConfigured || !integ.shopDomain) && (
        <div className="flex gap-2 items-start p-3 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-200 text-sm">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          Shopify no está conectado todavía: falta {!integ.shopDomain ? "SHOPIFY_SHOP_DOMAIN" : ""}{!integ.shopDomain && !integ.webhookSecretConfigured ? " y " : ""}{!integ.webhookSecretConfigured ? "SHOPIFY_WEBHOOK_SECRET" : ""} en el backend.
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {kpis.map((k) => (
          <button key={k.label} onClick={() => onGo(k.go)} className="text-left p-4 rounded-xl bg-white/[0.03] border border-white/10 hover:border-white/20">
            <p className="text-xs text-slate-400">{k.label}</p>
            <p className={cn("text-2xl font-bold mt-1", k.tone)}>{k.value}</p>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Solicitudes (cola de aprobación) ─────────────────────────────────────────
interface ReqRow {
  request: { id: number; status: string; requestedPlan: string | null; paymentVerified: boolean; lastError: string | null; reviewNotes: string | null; infoRequest: string | null; createdAt: string; orgId: number | null };
  order: { orderNumber: string | null; financialStatus: string; totalAmount: string | null; currency: string; isTest: boolean };
  customer: { email: string | null; name: string | null; companyName: string | null; taxId: string | null; phone: string | null } | null;
  orgName: string | null;
}
function RequestsTab() {
  const qc = useQueryClient();
  const [status, setStatus] = useState("pending_review,info_requested");
  const [open, setOpen] = useState<ReqRow | null>(null);
  const { data, isLoading } = useQuery<{ items: ReqRow[] }>({
    queryKey: ["commerce-requests", status], queryFn: () => getJson(`/activation-requests?status=${encodeURIComponent(status)}`),
  });
  const filters: [string, string][] = [["pending_review,info_requested", "Por revisar"], ["pending_payment", "Esperando pago"],
    ["activated", "Activadas"], ["rejected", "Rechazadas"], ["all", "Todas"]];
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap">
        {filters.map(([v, l]) => (
          <button key={v} onClick={() => setStatus(v)} className={cn("px-3 py-1 rounded-md text-xs border",
            status === v ? "border-blue-500 text-white bg-blue-500/10" : "border-white/10 text-slate-400")}>{l}</button>
        ))}
      </div>
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400 bg-white/[0.02]"><tr>
              {["#", "Cliente", "Plan", "Pedido", "Pago", "Estado", "Fecha", ""].map((h) => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}
            </tr></thead>
            <tbody>
              {(data?.items ?? []).map((r) => (
                <tr key={r.request.id} className="border-t border-white/5 text-slate-200">
                  <td className="px-3 py-2">{r.request.id}</td>
                  <td className="px-3 py-2">{r.customer?.companyName ?? r.customer?.name ?? "—"}<div className="text-xs text-slate-500">{r.customer?.email}</div></td>
                  <td className="px-3 py-2 capitalize">{r.request.requestedPlan ?? <span className="text-rose-300">SKU desconocido</span>}</td>
                  <td className="px-3 py-2">{r.order.orderNumber} · {eur(r.order.totalAmount, r.order.currency)} {r.order.isTest && <FlaskConical className="inline w-3.5 h-3.5 text-amber-400" />}</td>
                  <td className="px-3 py-2">{r.request.paymentVerified ? <Badge s="paid" /> : <Badge s={r.order.financialStatus} />}</td>
                  <td className="px-3 py-2"><Badge s={r.request.status} /></td>
                  <td className="px-3 py-2 text-slate-400">{fdate(r.request.createdAt)}</td>
                  <td className="px-3 py-2"><button onClick={() => setOpen(r)} className="text-blue-400 hover:text-blue-300 text-xs">Revisar</button></td>
                </tr>
              ))}
              {!data?.items.length && <tr><td colSpan={8} className="px-3 py-6 text-center text-slate-500">No hay solicitudes en este estado.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
      {open && <ReviewPanel row={open} onClose={() => { setOpen(null); qc.invalidateQueries({ queryKey: ["commerce-requests"] }); qc.invalidateQueries({ queryKey: ["commerce-dash"] }); }} />}
    </div>
  );
}

function ReviewPanel({ row, onClose }: { row: ReqRow; onClose: () => void }) {
  const id = row.request.id;
  const [mode, setMode] = useState<"approve" | "reject" | "info" | null>(null);
  const [text, setText] = useState("");
  const [linkOrgId, setLinkOrgId] = useState("");
  const [ownerEmail, setOwnerEmail] = useState(row.customer?.email ?? "");
  const [result, setResult] = useState<string | null>(null);
  const { data: detail } = useQuery<{ history: { id: number; action: string; actorClerkId: string | null; createdAt: string }[] }>({
    queryKey: ["commerce-request", id], queryFn: () => getJson(`/activation-requests/${id}`),
  });
  const reviewable = ["pending_review", "info_requested"].includes(row.request.status);
  const m = useMutation({
    mutationFn: async () => {
      if (mode === "approve") return postJson<{ orgId: number; invitationSent: boolean; invitationError: string | null; acceptUrl: string | null }>(
        `/activation-requests/${id}/approve`, { linkOrgId: linkOrgId ? Number(linkOrgId) : undefined, ownerEmail: ownerEmail || undefined, notes: text || undefined });
      if (mode === "reject") return postJson(`/activation-requests/${id}/reject`, { reason: text });
      return postJson(`/activation-requests/${id}/request-info`, { message: text });
    },
    onSuccess: (r: unknown) => {
      if (mode === "approve") {
        const a = r as { orgId: number; invitationSent: boolean; invitationError: string | null; acceptUrl: string | null };
        setResult(`Activada en el workspace #${a.orgId}. ${a.invitationSent ? "Invitación de bienvenida enviada." : `Invitación NO enviada (${a.invitationError}). Enlace: ${a.acceptUrl ?? "—"}`}`);
      } else setResult(mode === "reject" ? "Solicitud rechazada. Si procede, emite el reembolso desde Shopify." : "Petición de información registrada.");
    },
  });
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-lg h-full overflow-y-auto bg-[#0f1117] border-l border-white/10 p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex justify-between items-start">
          <div><h2 className="text-lg font-semibold text-white">Solicitud #{id}</h2><Badge s={row.request.status} /></div>
          <button onClick={onClose}><X className="w-5 h-5 text-slate-400" /></button>
        </div>
        <dl className="grid grid-cols-3 gap-y-2 text-sm">
          {[["Empresa", row.customer?.companyName], ["NIF", row.customer?.taxId], ["Contacto", row.customer?.name], ["Email", row.customer?.email],
            ["Teléfono", row.customer?.phone], ["Plan", row.request.requestedPlan], ["Pedido", `${row.order.orderNumber ?? ""} · ${eur(row.order.totalAmount, row.order.currency)}`],
            ["Pago", row.request.paymentVerified ? "Verificado" : "No verificado"], ["Workspace", row.orgName]].map(([k, v]) => (
            <Fragment key={String(k)}><dt className="text-slate-500">{k}</dt><dd className="col-span-2 text-slate-200">{v || "—"}</dd></Fragment>
          ))}
        </dl>
        {row.order.isTest && <p className="text-xs text-amber-300 flex gap-1 items-center"><FlaskConical className="w-3.5 h-3.5" /> Pedido de prueba: solo se puede activar si COMMERCE_ALLOW_TEST_ORDERS está activo.</p>}
        {row.request.lastError && <p className="text-xs text-rose-300">{row.request.lastError}</p>}
        {row.request.infoRequest && <p className="text-xs text-blue-300">Info pedida: {row.request.infoRequest}</p>}
        {row.request.reviewNotes && <p className="text-xs text-slate-400">Notas: {row.request.reviewNotes}</p>}

        {result ? <p className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 text-emerald-200 text-sm break-all">{result}</p> : reviewable && (
          <div className="space-y-3">
            <div className="flex gap-2">
              <button onClick={() => setMode("approve")} disabled={!row.request.paymentVerified}
                className={cn("flex-1 inline-flex justify-center items-center gap-1 px-3 py-2 rounded-lg text-sm border disabled:opacity-40",
                  mode === "approve" ? "bg-emerald-600 border-emerald-500 text-white" : "border-emerald-500/40 text-emerald-300")}><Check className="w-4 h-4" />Aprobar</button>
              <button onClick={() => setMode("info")} className={cn("flex-1 inline-flex justify-center items-center gap-1 px-3 py-2 rounded-lg text-sm border",
                mode === "info" ? "bg-blue-600 border-blue-500 text-white" : "border-blue-500/40 text-blue-300")}><HelpCircle className="w-4 h-4" />Pedir info</button>
              <button onClick={() => setMode("reject")} className={cn("flex-1 inline-flex justify-center items-center gap-1 px-3 py-2 rounded-lg text-sm border",
                mode === "reject" ? "bg-rose-600 border-rose-500 text-white" : "border-rose-500/40 text-rose-300")}><X className="w-4 h-4" />Rechazar</button>
            </div>
            {mode === "approve" && (
              <div className="space-y-2">
                <label className="block text-xs text-slate-400">Vincular a workspace existente (ID, opcional — vacío crea uno nuevo)
                  <input value={linkOrgId} onChange={(e) => setLinkOrgId(e.target.value.replace(/\D/g, ""))} className="mt-1 w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white" /></label>
                <label className="block text-xs text-slate-400">Email del propietario (recibe la invitación de bienvenida)
                  <input value={ownerEmail} onChange={(e) => setOwnerEmail(e.target.value)} className="mt-1 w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white" /></label>
              </div>
            )}
            {mode && (
              <>
                <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3}
                  placeholder={mode === "approve" ? "Notas internas (opcional)" : mode === "reject" ? "Motivo del rechazo (obligatorio)" : "¿Qué información necesitas? (se envía por email al cliente)"}
                  className="w-full bg-white/5 border border-white/10 rounded-md px-2 py-1.5 text-sm text-white" />
                <button onClick={() => m.mutate()} disabled={m.isPending || (mode !== "approve" && !text.trim())}
                  className="w-full inline-flex justify-center items-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm disabled:opacity-40">
                  {m.isPending && <Loader2 className="w-4 h-4 animate-spin" />}Confirmar
                </button>
                {m.error && <p className="text-xs text-rose-300">{(m.error as Error).message}</p>}
              </>
            )}
          </div>
        )}
        <div>
          <h3 className="text-sm font-medium text-white mb-2">Historial</h3>
          <ul className="space-y-1 text-xs text-slate-400">
            {(detail?.history ?? []).map((h) => <li key={h.id}>{fdate(h.createdAt)} · {h.action} · {h.actorClerkId ?? "sistema"}</li>)}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Tablas genéricas ─────────────────────────────────────────────────────────
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = any;
function SimpleTable({ path, cols, filterKey, filters, search }: {
  path: string; cols: [string, (r: Row) => React.ReactNode][]; filterKey?: string; filters?: string[]; search?: boolean;
}) {
  const [f, setF] = useState("all");
  const [q, setQ] = useState("");
  const qs = new URLSearchParams();
  if (filterKey && f !== "all") qs.set(filterKey, f);
  if (search && q) qs.set("q", q);
  const { data, isLoading, refetch, isFetching } = useQuery<{ items: Row[] }>({
    queryKey: ["commerce", path, qs.toString()], queryFn: () => getJson(`${path}?${qs.toString()}`),
  });
  return (
    <div className="space-y-3">
      <div className="flex gap-2 flex-wrap items-center">
        {filters?.map((v) => (
          <button key={v} onClick={() => setF(v)} className={cn("px-3 py-1 rounded-md text-xs border",
            f === v ? "border-blue-500 text-white bg-blue-500/10" : "border-white/10 text-slate-400")}>{v === "all" ? "Todos" : STATUS_LABEL[v] ?? v}</button>
        ))}
        {search && <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar…" className="bg-white/5 border border-white/10 rounded-md px-2 py-1 text-sm text-white" />}
        <button onClick={() => refetch()} className="ml-auto text-slate-400 hover:text-white"><RefreshCw className={cn("w-4 h-4", isFetching && "animate-spin")} /></button>
      </div>
      {isLoading ? <Loader2 className="w-5 h-5 animate-spin text-slate-400" /> : (
        <div className="overflow-x-auto rounded-xl border border-white/10">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-400 bg-white/[0.02]"><tr>{cols.map(([h]) => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {(data?.items ?? []).map((r, i) => (
                <tr key={r.id ?? r.order?.id ?? r.subscription?.id ?? i} className="border-t border-white/5 text-slate-200">
                  {cols.map(([h, fn]) => <td key={h} className="px-3 py-2">{fn(r)}</td>)}
                </tr>
              ))}
              {!data?.items.length && <tr><td colSpan={cols.length} className="px-3 py-6 text-center text-slate-500">Sin registros.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProductsTab() {
  const qc = useQueryClient();
  const { data } = useQuery<{ items: Row[] }>({ queryKey: ["commerce-products"], queryFn: () => getJson("/products") });
  const save = useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) => postJson(`/products/${id}`, body, "PATCH"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commerce-products"] }),
  });
  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-400">El precio sale de la tarifa oficial (OmniCredits → planes). En Shopify, cada variante debe llevar como SKU el identificador interno.</p>
      <div className="overflow-x-auto rounded-xl border border-white/10">
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-400 bg-white/[0.02]"><tr>{["SKU (= Shopify)", "Producto", "Precio", "Módulos", "Variante Shopify", "Venta online"].map((h) => <th key={h} className="text-left px-3 py-2 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {(data?.items ?? []).map((p) => (
              <tr key={p.id} className="border-t border-white/5 text-slate-200">
                <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2">{p.priceCustom ? "A medida" : `${eur(p.priceAmount, p.currency)}/mes`}</td>
                <td className="px-3 py-2 text-xs text-slate-400">{(p.modules as string[]).includes("*") ? "Todos" : (p.modules as string[]).length}</td>
                <td className="px-3 py-2">
                  <input defaultValue={p.shopifyVariantId ?? ""} placeholder="gid o id" className="w-36 bg-white/5 border border-white/10 rounded px-2 py-1 text-xs"
                    onBlur={(e) => e.target.value !== (p.shopifyVariantId ?? "") && save.mutate({ id: p.id, body: { shopifyVariantId: e.target.value } })} />
                </td>
                <td className="px-3 py-2">{p.priceCustom ? <span className="text-xs text-slate-500">Solicitar demo</span> : (
                  <input type="checkbox" checked={p.isActive} onChange={(e) => save.mutate({ id: p.id, body: { isActive: e.target.checked } })} />
                )}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {save.error && <p className="text-xs text-rose-300">{(save.error as Error).message}</p>}
    </div>
  );
}

function IntegrationsTab() {
  const qc = useQueryClient();
  const { data: dash } = useQuery<Dash>({ queryKey: ["commerce-dash"], queryFn: () => getJson("/dashboard") });
  const retry = useMutation({
    mutationFn: (id: number) => postJson(`/webhook-events/${id}/retry`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commerce", "/webhook-events"] }),
  });
  const i = dash?.integration;
  return (
    <div className="space-y-4">
      <div className="grid md:grid-cols-3 gap-3 text-sm">
        {[["Tienda", i?.shopDomain ?? "Sin configurar", !!i?.shopDomain], ["Firma de webhooks (HMAC)", i?.webhookSecretConfigured ? "Configurada" : "Falta secreto", !!i?.webhookSecretConfigured],
          ["Admin API (re-verificación de pago)", i?.adminApiConfigured ? "Configurada" : "Opcional — no configurada", !!i?.adminApiConfigured]].map(([k, v, ok]) => (
          <div key={String(k)} className="p-3 rounded-xl border border-white/10 bg-white/[0.03]">
            <p className="text-xs text-slate-400">{k}</p><p className={ok ? "text-emerald-300" : "text-amber-300"}>{v}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-slate-500">Endpoint de webhooks: <span className="font-mono">/api/commerce/webhooks/shopify</span></p>
      <SimpleTable path="/webhook-events" filterKey="status" filters={["all", "failed", "processed", "ignored"]}
        cols={[["Topic", (r) => <span className="font-mono text-xs">{r.topic}</span>], ["Estado", (r) => <Badge s={r.status} />], ["Intentos", (r) => r.attempts],
          ["Error", (r) => <span className="text-xs text-rose-300">{r.lastError ?? ""}</span>], ["Recibido", (r) => fdate(r.receivedAt)],
          ["", (r) => (r.status === "failed" ? <button onClick={() => retry.mutate(r.id)} className="text-xs text-blue-400">Reintentar</button> : null)]]} />
    </div>
  );
}
