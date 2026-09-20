import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactNode } from "react";

// ── Mocks: sesión/permisos y red ────────────────────────────────────────────────────────────────────
const session = vi.hoisted(() => ({
  orgId: 1 as number | null,
  loading: false,
  permissions: ["agents.read", "agents.write"] as string[],
  platformRole: "NONE",
}));
const authFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/orgContext", () => ({
  useOrg: () => ({
    org: session.orgId === null ? null : { id: session.orgId, name: `Org ${session.orgId}`, slug: "o", plan: "starter", role: "member" },
    loading: session.loading,
    platformRole: session.platformRole,
    platformRoleLoading: false,
    permissions: session.permissions,
    hasPermission: (p: string) => session.permissions.includes(p),
  }),
}));
vi.mock("@/lib/authFetch", () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

import AgentsPage from "@/pages/agents";
import { Toaster } from "@/components/ui/toaster";

// ── Datos de prueba con la forma real de las respuestas del backend ─────────────────────────────────
const agent = (id: number, name: string, over: Record<string, unknown> = {}) => ({
  id, orgId: 1, name, description: `Descripción de ${name}`, avatarUrl: null, status: "draft", activeVersionId: null,
  limits: {}, monthlyCreditLimit: null, dailyCreditLimit: null, perExecutionCreditLimit: null,
  createdBy: "u", createdAt: "2026-05-01T10:00:00Z", updatedAt: "2026-05-01T10:00:00Z", activeVersionNumber: null, ...over,
});

const dashboard = (over: Record<string, unknown> = {}) => ({
  plan: "starter", balance: 12500, held: 0, available: 12500,
  period: { key: "2026-05", start: "2026-05-01", end: "2026-05-31", renewsAt: "2026-06-01T00:00:00Z" },
  included: 50000, used: 37500, usedToday: 100, pctConsumed: 75,
  limits: { monthly: 60000, daily: null, perAgentMonthly: null, blockAtLimit: true },
  pricing: { provisionalCredits: 0, provisionalRuns: 0, provisional: false },
  creditsUsed: 37500, creditsRemaining: 12500, monthlyCredits: 50000, rolloverCredits: 2000, extraCredits: 500,
  includedRemaining: 12500, usagePercentage: 75, renewalDate: "2026-06-01T00:00:00Z", provisionalCredits: 0,
  usedByOrigin: { included: 37500, rollover: 0, extra: 0 }, byAgent: [], byModel: [], byFeature: [], daily: [], byDay: [], monthly: [],
  forecast: { projectedMonthCredits: 40000, basis: "linear" }, alerts: [], ...over,
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

type Routes = Partial<Record<"list" | "balance" | "credits" | "defaults", () => Response | Promise<Response>>>;
function serve(routes: Routes = {}) {
  authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/agents/, "");
    if (init?.method === "POST") return routes.list ? routes.list() : json(201, { agent: agent(42, "Nuevo"), version: {} });
    if (path === "/credits/balance") return (routes.balance ?? (() => json(200, { balance: 12500, held: 0, available: 12500 })))();
    if (path === "/credits") return (routes.credits ?? (() => json(200, dashboard())))();
    if (path === "/defaults") return (routes.defaults ?? (() => json(200, [])))();
    return (routes.list ?? (() => json(200, [])))();
  });
}

function mount(ui: ReactNode = <AgentsPage />) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  const loc = memoryLocation({ path: "/agents", record: true });
  const wrap = (node: ReactNode) => (
    <QueryClientProvider client={client}>
      <Router hook={loc.hook}>{node}<Toaster /></Router>
    </QueryClientProvider>
  );
  const utils = render(wrap(ui));
  return { ...utils, client, loc, // elemento nuevo: si no, React reutiliza el render anterior y el mock de useOrg no se vuelve a leer
    rerender: () => utils.rerender(wrap(<AgentsPage />)) };
}

beforeEach(() => {
  authFetch.mockReset();
  session.orgId = 1;
  session.loading = false;
  session.permissions = ["agents.read", "agents.write"];
  session.platformRole = "NONE";
});

describe("página /agents", () => {
  it("1. muestra la lista de agentes con estado, versión activa, presupuesto y agente por defecto", async () => {
    serve({
      list: () => json(200, [
        agent(1, "Ventas", { status: "published", activeVersionNumber: 3, monthlyCreditLimit: 5000, dailyCreditLimit: 200 }),
        agent(2, "Soporte"),
      ]),
      defaults: () => json(200, [{ id: 1, orgId: 1, channel: "all", agentId: 1, createdAt: "", updatedAt: "" }]),
    });
    mount();

    expect(await screen.findByTestId("agent-card-1")).toBeInTheDocument();
    expect(screen.getByTestId("agent-card-1")).toHaveAttribute("href", "/agents/1");
    expect(within(screen.getByTestId("agent-card-1")).getByText("Ventas")).toBeInTheDocument();
    expect(within(screen.getByTestId("agent-card-1")).getByText("Publicado")).toBeInTheDocument();
    expect(within(screen.getByTestId("agent-card-2")).getByText("Borrador")).toBeInTheDocument();
    expect(screen.getByTestId("agent-version-1")).toHaveTextContent("Versión activa v3");
    expect(screen.getByTestId("agent-version-2")).toHaveTextContent("Sin versión activa");
    expect(screen.getByTestId("agent-budget-1")).toHaveTextContent("5.000 al mes");
    expect(await screen.findByTestId("agent-default-1")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-default-2")).not.toBeInTheDocument();
    expect(screen.getByText("Gestiona tus agentes de IA, sus versiones y su consumo.")).toBeInTheDocument();
  });

  it("2. muestra el estado vacío", async () => {
    serve({ list: () => json(200, []) });
    mount();
    expect(await screen.findByTestId("agents-empty")).toBeInTheDocument();
    expect(screen.getByText("Aún no tienes agentes")).toBeInTheDocument();
    expect(screen.queryByTestId("agents-list")).not.toBeInTheDocument();
  });

  it("3. muestra un error de API con su código técnico y permite reintentar", async () => {
    serve({ list: () => json(500, { error: "boom" }) });
    mount();
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/HTTP 500/);
    expect(screen.getByTestId("error-technical")).toHaveTextContent("HTTP 500");
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });

  it("4. INSUFFICIENT_CREDITS se explica con un mensaje propio y conserva el código visible", async () => {
    serve({ list: () => json(402, { status: "INSUFFICIENT_CREDITS", message: "Créditos insuficientes: disponibles 0" }) });
    mount();
    expect(await screen.findByText("Créditos insuficientes")).toBeInTheDocument();
    expect(screen.getByTestId("error-technical")).toHaveTextContent("Código: INSUFFICIENT_CREDITS · HTTP 402");
    expect(screen.getByRole("alert")).toHaveTextContent(/no se ha cobrado nada/i);
  });

  it("5. renderiza el saldo y el consumo del periodo con datos reales (sin dólares)", async () => {
    serve({ balance: () => json(200, { balance: 13000, held: 500, available: 12500 }) });
    mount();
    expect(await screen.findByTestId("balance-available")).toHaveTextContent("12.500");
    expect(screen.getByTestId("balance-held")).toHaveTextContent("500");
    expect(await screen.findByTestId("usage-percentage")).toHaveTextContent("75 % consumido");
    expect(screen.getByTestId("stat-used")).toHaveTextContent("37.500");
    expect(screen.getByTestId("stat-monthly-limit")).toHaveTextContent("60.000");
    expect(screen.getByTestId("stat-daily-limit")).toHaveTextContent("Sin límite");
    expect(screen.getByTestId("stat-rollover")).toHaveTextContent("2.000");
    expect(screen.getByTestId("stat-extra")).toHaveTextContent("500");
    expect(screen.getByTestId("credits-summary").textContent).not.toMatch(/\$|USD/);
    expect(screen.queryByTestId("provisional-badge")).not.toBeInTheDocument();
    // nunca pide el modo técnico
    for (const [url] of authFetch.mock.calls) expect(String(url)).not.toMatch(/technical/);
  });

  it("5b. avisa con «Precio provisional» cuando parte del consumo usó un precio provisional", async () => {
    serve({ credits: () => json(200, dashboard({ provisionalCredits: 900, pricing: { provisionalCredits: 900, provisionalRuns: 3, provisional: true } })) });
    mount();
    expect(await screen.findByTestId("provisional-badge")).toHaveTextContent("Precio provisional");
    expect(screen.getByTestId("provisional-note")).toHaveTextContent("900");
  });

  it("6. con agents.write aparece «Crear agente»; crea, avisa y navega al detalle con el id devuelto", async () => {
    serve({ list: () => json(200, []) });
    const { loc } = mount();
    const trigger = await screen.findAllByTestId("create-agent-button");
    fireEvent.click(trigger[0]!);

    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "  Nuevo  " } });
    fireEvent.change(screen.getByLabelText(/Descripción/), { target: { value: "" } });
    serve({ list: () => json(201, { agent: agent(42, "Nuevo"), version: { id: 1 } }) });
    fireEvent.click(screen.getByRole("button", { name: /^crear agente$/i, hidden: false }));

    await waitFor(() => expect(loc.history!.at(-1)).toBe("/agents/42"));
    const post = authFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === "POST")!;
    expect(JSON.parse((post[1] as RequestInit).body as string)).toEqual({ name: "Nuevo", description: null, avatarUrl: null });
    expect(await screen.findByText("Agente creado")).toBeInTheDocument();
  });

  it("6b. un error al crear (INSUFFICIENT_CREDITS o permiso) se muestra en el diálogo sin cerrarlo", async () => {
    serve({ list: () => json(200, []) });
    mount();
    fireEvent.click((await screen.findAllByTestId("create-agent-button"))[0]!);
    fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: "X" } });
    serve({ list: () => json(403, { error: "permission_denied", message: "No tienes permiso (agents.write)" }) });
    fireEvent.click(screen.getByRole("button", { name: /^crear agente$/i }));
    expect(await screen.findByText("Sin permiso")).toBeInTheDocument();
    expect(screen.getByTestId("error-technical")).toHaveTextContent("permission_denied");
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
  });

  it("7a. sin agents.write no hay botón de crear, pero se ve la lista (solo lectura)", async () => {
    session.permissions = ["agents.read"];
    serve({ list: () => json(200, [agent(1, "Ventas")]) });
    mount();
    expect(await screen.findByTestId("agent-card-1")).toBeInTheDocument();
    expect(screen.queryByTestId("create-agent-button")).not.toBeInTheDocument();
  });

  it("7b. sin agents.read no hay acceso: mensaje claro y ninguna llamada a la API", async () => {
    session.permissions = [];
    serve();
    mount();
    expect(await screen.findByTestId("agents-no-access")).toHaveTextContent("agents.read");
    expect(screen.queryByTestId("create-agent-button")).not.toBeInTheDocument();
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("7c. SUPER_ADMIN pasa igual que en el backend", async () => {
    session.permissions = [];
    session.platformRole = "SUPER_ADMIN";
    serve({ list: () => json(200, []) });
    mount();
    expect((await screen.findAllByTestId("create-agent-button")).length).toBeGreaterThan(0);
  });

  it("8. cambiar de workspace no reutiliza los datos del anterior (claves de caché por workspace)", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    serve({
      list: async () => {
        // el workspace 2 tarda: mientras carga no se puede ver la lista del 1
        if (session.orgId === 2) await gate;
        return json(200, [agent(session.orgId === 1 ? 1 : 2, session.orgId === 1 ? "Agente del WS1" : "Agente del WS2")]);
      },
    });
    const { client, rerender } = mount();
    expect(await screen.findByText("Agente del WS1")).toBeInTheDocument();

    session.orgId = 2;
    rerender();

    expect(screen.queryByText("Agente del WS1")).not.toBeInTheDocument();
    expect(screen.getByTestId("agents-loading")).toBeInTheDocument();

    release();
    expect(await screen.findByText("Agente del WS2")).toBeInTheDocument();
    expect(screen.queryByText("Agente del WS1")).not.toBeInTheDocument();

    // ambas cachés conviven, cada una bajo su workspace
    expect(client.getQueryData(["agents", 1])).toHaveLength(1);
    expect(client.getQueryData(["agents", 2])).toHaveLength(1);
    expect(client.getQueryData(["credits-balance", 1])).toBeDefined();
    expect(client.getQueryData(["credits-balance", 2])).toBeDefined();
    expect(client.getQueryData(["credits", 2])).toBeDefined();
  });

  it("sin workspace activo no se lanza ninguna consulta", async () => {
    session.orgId = null;
    serve();
    mount();
    await waitFor(() => expect(screen.getByTestId("agents-loading")).toBeInTheDocument());
    expect(authFetch).not.toHaveBeenCalled();
  });
});
