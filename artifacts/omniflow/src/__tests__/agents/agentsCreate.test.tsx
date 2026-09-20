import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

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
import { agent, json } from "./fixtures";

const balance = { balance: 100, held: 0, available: 100 };
const dashboard = {
  plan: "starter", balance: 100, held: 0, available: 100,
  period: { key: "2026-05", start: "2026-05-01", end: "2026-05-31", renewsAt: "2026-06-01T00:00:00Z" },
  included: 1000, used: 900, usedToday: 0, pctConsumed: 90, limits: null,
  pricing: { provisionalCredits: 0, provisionalRuns: 0, provisional: false },
  creditsUsed: 900, creditsRemaining: 100, monthlyCredits: 1000, rolloverCredits: 0, extraCredits: 0, includedRemaining: 100,
  usagePercentage: 90, renewalDate: "2026-06-01T00:00:00Z", provisionalCredits: 0,
  usedByOrigin: { included: 900, rollover: 0, extra: 0 }, byAgent: [], byModel: [], byFeature: [], daily: [], byDay: [], monthly: [],
  forecast: { projectedMonthCredits: 1000, basis: "linear" }, alerts: [],
};

type Post = () => Response | Promise<Response>;
function serve(opts: { list?: () => Response | Promise<Response>; post?: Post } = {}) {
  authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/agents/, "");
    if (init?.method === "POST") return (opts.post ?? (() => json(201, { agent: agent(42, "Nuevo"), version: { id: 1 } })))();
    if (path === "/credits/balance") return json(200, balance);
    if (path === "/credits") return json(200, dashboard);
    if (path === "/defaults") return json(200, []);
    return (opts.list ?? (() => json(200, [])))();
  });
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  const loc = memoryLocation({ path: "/agents", record: true });
  render(
    <QueryClientProvider client={client}>
      <Router hook={loc.hook}><AgentsPage /><Toaster /></Router>
    </QueryClientProvider>,
  );
  return { client, loc };
}

async function submitCreate(name = "Nuevo") {
  fireEvent.click((await screen.findAllByTestId("create-agent-button"))[0]!);
  fireEvent.change(await screen.findByLabelText("Nombre"), { target: { value: name } });
  fireEvent.click(screen.getByRole("button", { name: /^crear agente$/i }));
}

beforeEach(() => {
  authFetch.mockReset();
  session.orgId = 1;
  session.loading = false;
  session.permissions = ["agents.read", "agents.write"];
  session.platformRole = "NONE";
});

describe("lista — estados", () => {
  it("mientras carga muestra el esqueleto y no la lista ni el vacío", async () => {
    serve({ list: () => new Promise<Response>(() => undefined) });
    mount();
    expect(await screen.findByTestId("agents-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("agents-empty")).not.toBeInTheDocument();
    expect(screen.queryByTestId("agents-list")).not.toBeInTheDocument();
  });

  it("mientras carga la sesión no se llama a la API", async () => {
    session.loading = true;
    serve();
    mount();
    expect(await screen.findByTestId("agents-loading")).toBeInTheDocument();
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("cada agente muestra su fecha de actualización y los cuatro estados reales usan su etiqueta", async () => {
    serve({
      list: () => json(200, (["draft", "published", "paused", "archived"] as const).map((s, i) => agent(i + 1, `A${i + 1}`, { status: s }))),
    });
    mount();
    expect(await screen.findByTestId("agent-updated-1")).toHaveTextContent(/2026/);
    for (const [id, label] of [[1, "Borrador"], [2, "Publicado"], [3, "Pausado"], [4, "Archivado"]] as const) {
      expect(screen.getByTestId(`agent-card-${id}`)).toHaveTextContent(label);
    }
  });

  it("el saldo se ve en la misma página, de forma compacta", async () => {
    serve();
    mount();
    expect(await screen.findByTestId("balance-available")).toHaveTextContent("100");
  });
});

describe("creación", () => {
  it("crea con los campos soportados (sin config), navega al agente y solo invalida la lista de este workspace", async () => {
    serve();
    const { client, loc } = mount();
    await screen.findByTestId("agents-empty");
    await waitFor(() => expect(client.getQueryData(["credits", 1])).toBeDefined());
    const spy = vi.spyOn(client, "invalidateQueries");

    await submitCreate("  Nuevo  ");

    await waitFor(() => expect(loc.history!.at(-1)).toBe("/agents/42"));
    expect(await screen.findByText("Agente creado")).toBeInTheDocument();
    const post = authFetch.mock.calls.find(([, i]) => (i as RequestInit | undefined)?.method === "POST")!;
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body).toEqual({ name: "Nuevo", description: null, avatarUrl: null });
    expect(body).not.toHaveProperty("config");
    // crear un agente no cambia créditos ni agentes por defecto: no se invalidan
    expect(spy.mock.calls.map(([f]) => f?.queryKey)).toEqual([["agents", 1]]);
  });

  it.each([
    [402, { status: "INSUFFICIENT_CREDITS", message: "Créditos insuficientes: disponibles 0" }, "Créditos insuficientes", "INSUFFICIENT_CREDITS"],
    [409, { status: "DUPLICATE_REQUEST", message: "Petición duplicada" }, "Petición duplicada", "DUPLICATE_REQUEST"],
    [409, { status: "REFERENCE_CONFLICT", message: "Referencia en uso" }, "Referencia ya utilizada", "REFERENCE_CONFLICT"],
    [429, { status: "BUDGET_BLOCKED", message: "Presupuesto agotado" }, "Presupuesto de IA bloqueado", "BUDGET_BLOCKED"],
    [503, { status: "PROVIDER_UNAVAILABLE", message: "Proveedor caído" }, "Proveedor de IA no disponible", "PROVIDER_UNAVAILABLE"],
  ])("error %i %s: mensaje propio con el código visible, el diálogo sigue abierto y no navega", async (status, body, title, code) => {
    serve({ post: () => json(status, body) });
    const { loc } = mount();
    await screen.findByTestId("agents-empty");
    await submitCreate();
    const technical = await screen.findByTestId("error-technical");
    expect(screen.getByRole("alert")).toHaveTextContent(title);
    expect(technical).toHaveTextContent(`Código: ${code} · HTTP ${status}`);
    expect(screen.getByLabelText("Nombre")).toBeInTheDocument();
    expect(loc.history!.at(-1)).toBe("/agents");
  });

  it("un error sin código conocido no se disfraza de otro: se ve su HTTP", async () => {
    serve({ post: () => json(500, { error: "boom" }) });
    mount();
    await screen.findByTestId("agents-empty");
    await submitCreate();
    expect(await screen.findByTestId("error-technical")).toHaveTextContent("HTTP 500");
  });

  it("sin agents.write no se puede crear ni desde el estado vacío", async () => {
    session.permissions = ["agents.read"];
    serve();
    mount();
    await screen.findByTestId("agents-empty");
    expect(screen.queryByTestId("create-agent-button")).not.toBeInTheDocument();
  });
});
