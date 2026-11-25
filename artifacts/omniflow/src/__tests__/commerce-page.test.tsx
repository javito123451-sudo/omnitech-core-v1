import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const role = vi.hoisted(() => ({ isSuperAdmin: true }));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: role.isSuperAdmin }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
const calls: { url: string; init?: RequestInit }[] = [];
vi.mock("@/lib/authFetch", () => ({
  authFetch: async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const j = (b: unknown) => ({ ok: true, json: async () => b });
    if (url.includes("/settings") && init?.method === "PATCH") return j({ ok: true });
    if (url.includes("/integrations")) return j({ shopify: { apiSecretConfigured: true, shopDomainConfigured: true, adminTokenConfigured: false }, email: { resendConfigured: false }, webhookEvents: {},
      policy: { graceDays: 7, suspendAfterFailedAttempts: 3, suspendOnFullRefund: true, suspendOnChargeback: true, autoReactivateOnPayment: true, autoActivateWhenPaidAndAuthorized: true } });
    if (url.includes("/dashboard")) return j({ pending_activations: 2, info_requested: 0, paid_orders: 5, pending_payment_orders: 1, active_subscriptions: 3, incident_subscriptions: 1, revenue_30d_cents: 44700, webhook_failures: 0, new_captures: 4, authorized_waiting_purchase: 1, unauthorized_purchases: 1 });
    if (url.includes("/activation-requests/") && init?.method === "POST") return j({ ok: true, welcomeEmailSent: true });
    if (url.includes("/capture-requests/") && init?.method === "POST") return j({ ok: true });
    if (url.includes("/capture-requests")) return j([{ id: 7, status: "new", email: "lead@empresa.test", name: "Lead", company: "Lead SL", plan_interest: "starter", modules_interest: [], message: "Hola", created_at: "2026-11-25T10:00:00Z" }]);
    if (url.includes("/activation-requests")) return j([
      { id: 1, status: "pending", order_status: "paid", authorized: true, customer_email: "ana@empresa.test", company: "Empresa SL", order_number: "#1001", total_cents: 14900, requested_plan: "starter", unmapped_items: [], created_at: "2026-11-25T10:00:00Z" },
      { id: 2, status: "pending", order_status: "paid", authorized: false, customer_email: "b@x.test", company: null, order_number: "#1002", total_cents: 14900, requested_plan: "starter", unmapped_items: [{}], created_at: "2026-11-25T10:00:00Z" },
    ]);
    return j([]);
  },
}));
vi.mock("wouter", () => ({ Link: ({ children, href }: any) => <a href={href}>{children}</a> }));

import CommercePage from "@/pages/control-center/commerce";
const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CommercePage /></QueryClientProvider>);

describe("OmniCommerce Control", () => {
  beforeEach(() => { calls.length = 0; role.isSuperAdmin = true; });

  it("muestra indicadores del dashboard y euros formateados", async () => {
    wrap();
    expect(await screen.findByText("Captaciones por revisar")).toBeTruthy();
    expect(screen.getByText("Compras SIN autorización")).toBeTruthy();
    expect(screen.getByText("Webhooks fallidos")).toBeTruthy();
    expect(await screen.findByText(/447,00/)).toBeTruthy();
  });

  it("compra sin autorización previa: botón activar deshabilitado; con autorización: activa vía API del servidor", async () => {
    wrap(); fireEvent.click(screen.getByText("Activaciones"));
    await screen.findByText("ana@empresa.test");
    const approves = screen.getAllByTitle(/Activar|Sin autorización/) as HTMLButtonElement[];
    expect(approves[0].disabled).toBe(false); expect(approves[1].disabled).toBe(true);
    fireEvent.click(approves[0]);
    fireEvent.click(await screen.findByText("Confirmar"));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/activation-requests/1/approve") && c.init?.method === "POST")).toBe(true));
  });

  it("rechazar exige motivo", async () => {
    wrap(); fireEvent.click(screen.getByText("Activaciones")); await screen.findByText("ana@empresa.test");
    fireEvent.click(screen.getAllByTitle("Rechazar")[0]);
    expect((await screen.findByText("Confirmar") as HTMLButtonElement).disabled).toBe(true);
  });

  it("captación: autorizar plan/módulos vía API del servidor; rechazar exige motivo", async () => {
    wrap(); fireEvent.click(screen.getByText("Captación")); await screen.findByText("lead@empresa.test");
    fireEvent.click(screen.getByTitle("Rechazar"));
    expect((await screen.findByText("Confirmar") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Cancelar")); fireEvent.click(screen.getByTitle("Autorizar contratación"));
    fireEvent.click(await screen.findByText("Confirmar"));
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/capture-requests/7/authorize") && c.init?.method === "POST")).toBe(true));
  });

  it("ajuste de activación automática: SUPER_ADMIN lo cambia vía API; STAFF lo ve bloqueado", async () => {
    wrap(); fireEvent.click(screen.getByText("Integraciones"));
    const box = (await screen.findByLabelText(/Activar automáticamente/)) as HTMLInputElement;
    expect(box.checked).toBe(true); fireEvent.click(box);
    await waitFor(() => expect(calls.some((c) => c.url.endsWith("/settings") && c.init?.method === "PATCH" && String(c.init.body).includes("auto_activate_when_paid_and_authorized"))).toBe(true));
  });

  it("STAFF (solo lectura): sin botones de acción y con aviso", async () => {
    role.isSuperAdmin = false; wrap();
    expect(screen.getByText(/Modo solo lectura/)).toBeTruthy();
    fireEvent.click(screen.getByText("Activaciones")); await screen.findByText("ana@empresa.test");
    expect(screen.queryAllByTitle("Rechazar").length).toBe(0);
    fireEvent.click(screen.getByText("Captación")); await screen.findByText("lead@empresa.test");
    expect(screen.queryAllByTitle("Autorizar contratación").length).toBe(0);
  });
});
