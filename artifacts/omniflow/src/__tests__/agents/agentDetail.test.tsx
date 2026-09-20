import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const session = vi.hoisted(() => ({
  orgId: 1 as number | null,
  loading: false,
  permissions: ["agents.read"] as string[],
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

import AgentDetailPage from "@/pages/agent-detail";
import { Toaster } from "@/components/ui/toaster";
import { agent, config, defaultReadRoute, json, simulation, version } from "./fixtures";

type Handler = (init?: RequestInit) => Response | Promise<Response>;
type Routes = Record<string, Handler>;   // "GET /7", "POST /7/publish"…

/** Detalle de un agente publicado con la v2 activa y un borrador v3. */
const detail = (over: { agent?: Record<string, unknown>; versions?: unknown[] } = {}) => ({
  agent: agent(7, "Ventas", { status: "published", activeVersionId: 20, ...over.agent }),
  versions: over.versions ?? [
    version(30, 3, { notes: "Borrador nuevo" }),
    version(20, 2, { publishedAt: "2026-05-02T09:00:00Z", config: config({ channels: ["web", "whatsapp"], identity: { role: "Vendedor senior" } }) }),
    version(10, 1, { publishedAt: "2026-05-01T09:00:00Z" }),
  ],
});

function serve(routes: Routes) {
  authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/agents/, "");
    const key = `${init?.method ?? "GET"} ${path}`;
    const h = routes[key];
    if (!h) { const d = defaultReadRoute(key); if (d) return d; throw new Error(`ruta no prevista en el test: ${key}`); }
    return h(init);
  });
}

const calls = (key: string) =>
  authFetch.mock.calls.filter(([u, i]) => `${(i as RequestInit | undefined)?.method ?? "GET"} ${String(u).replace(/^.*\/api\/agents/, "")}` === key);

function mount(path = "/agents/7") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  const loc = memoryLocation({ path, record: true });
  const tree = () => (
    <QueryClientProvider client={client}>
      <Router hook={loc.hook}>
        <Route path="/agents/:id" component={AgentDetailPage} />
        <Toaster />
      </Router>
    </QueryClientProvider>
  );
  const utils = render(tree());
  return { client, loc, rerender: () => utils.rerender(tree()) };
}

beforeEach(() => {
  authFetch.mockReset();
  session.orgId = 1;
  session.loading = false;
  session.permissions = ["agents.read"];
  session.platformRole = "NONE";
});

describe("detalle /agents/:id — lectura", () => {
  it("carga la cabecera: nombre, estado, versión activa, descripción y fecha", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    expect(await screen.findByTestId("agent-name")).toHaveTextContent("Ventas");
    const header = screen.getByTestId("agent-header");
    expect(within(header).getByText("Publicado")).toBeInTheDocument();
    expect(screen.getByTestId("agent-description")).toHaveTextContent("Descripción de Ventas");
    expect(screen.getByTestId("agent-active-version")).toHaveTextContent("Versión activa: v2");
    expect(screen.getByTestId("agent-updated")).toHaveTextContent(/2026/);
  });

  it("muestra la configuración real de la versión activa (identidad, personalidad, comportamiento, contexto)", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    expect(await screen.findByTestId("config-title")).toHaveTextContent("versión activa v2");
    expect(screen.getByTestId("cfg-identity")).toHaveTextContent("Vendedor senior");
    expect(screen.getByTestId("cfg-identity")).toHaveTextContent("Atender consultas de clientes");
    expect(screen.getByTestId("cfg-personality")).toHaveTextContent("cercano");
    expect(screen.getByTestId("cfg-behavior")).toHaveTextContent("Responde con amabilidad.");
    expect(screen.getByTestId("cfg-behavior")).toHaveTextContent("Taller mecánico en Valencia");
    expect(screen.getByTestId("cfg-behavior")).toHaveTextContent("Saluda siempre");
    expect(screen.getByTestId("cfg-model")).toHaveTextContent("0.4");
  });

  it("los canales salen únicamente de la configuración de la versión mostrada", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const ch = await screen.findByTestId("cfg-channels");
    expect(ch).toHaveTextContent("Web");
    expect(ch).toHaveTextContent("WhatsApp");
    expect(ch).not.toHaveTextContent("Telegram");
  });

  it("sin canales en la configuración se dice «Ninguno» (no se inventan)", async () => {
    serve({ "GET /7": () => json(200, detail({ versions: [version(20, 2, { publishedAt: "2026-05-02T09:00:00Z", config: config({ channels: [] }) })] })) });
    mount();
    expect(await screen.findByTestId("cfg-channels")).toHaveTextContent("Ninguno");
  });

  it("lista las versiones con su estado, la activa y la fecha", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    expect(await screen.findByTestId("versions")).toHaveTextContent("Versiones (3)");
    expect(screen.getByTestId("version-3")).toHaveTextContent("Borrador");
    expect(screen.getByTestId("version-3")).toHaveTextContent("Borrador nuevo");
    expect(screen.getByTestId("version-2")).toHaveTextContent("Publicada");
    expect(screen.getByTestId("version-2")).toHaveTextContent("Activa");
    expect(screen.getByTestId("version-2")).toHaveTextContent(/2026/);
    expect(screen.getByTestId("version-1")).not.toHaveTextContent("Activa");
  });

  it("sin versión activa muestra la última versión y lo dice", async () => {
    serve({ "GET /7": () => json(200, detail({ agent: { status: "draft", activeVersionId: null }, versions: [version(30, 1)] })) });
    mount();
    expect(await screen.findByTestId("config-title")).toHaveTextContent("última versión (borrador) v1");
    expect(screen.getByTestId("agent-active-version")).toHaveTextContent("Sin versión activa");
  });

  it("mientras carga muestra el esqueleto", async () => {
    serve({ "GET /7": () => new Promise<Response>(() => undefined) });
    mount();
    expect(await screen.findByTestId("agent-loading")).toBeInTheDocument();
  });

  it("un error de API muestra el código técnico y reintentar", async () => {
    serve({ "GET /7": () => json(500, { error: "boom" }) });
    mount();
    expect(await screen.findByTestId("error-technical")).toHaveTextContent("HTTP 500");
    expect(screen.getByRole("button", { name: /reintentar/i })).toBeInTheDocument();
  });

  it("agente inexistente (404) se explica con el mensaje del backend", async () => {
    serve({ "GET /999": () => json(404, { error: "Agente no encontrado." }) });
    mount("/agents/999");
    expect(await screen.findByText("Agente no encontrado.")).toBeInTheDocument();
    expect(screen.getByTestId("error-technical")).toHaveTextContent("HTTP 404");
  });

  it("un id que no es un número no llama a la API", async () => {
    serve({});
    mount("/agents/abc");
    expect(await screen.findByRole("alert")).toHaveTextContent(/no es válido/);
    expect(authFetch).not.toHaveBeenCalled();
  });
});

describe("detalle — permisos y workspace", () => {
  it("sin agents.read: acceso restringido y ninguna llamada", async () => {
    session.permissions = [];
    serve({});
    mount();
    expect(await screen.findByTestId("agents-no-access")).toBeInTheDocument();
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("sin workspace activo no se llama a la API", async () => {
    session.orgId = null;
    serve({});
    mount();
    await screen.findByTestId("agent-loading");
    expect(authFetch).not.toHaveBeenCalled();
  });

  it("agents.read y agents.write NO permiten publicar: no aparece el botón", async () => {
    session.permissions = ["agents.read", "agents.write"];
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    await screen.findByTestId("agent-name");
    expect(screen.queryByTestId("publish-agent-button")).not.toBeInTheDocument();
  });

  it("con agents.publish y un borrador pendiente aparece «Publicar»", async () => {
    session.permissions = ["agents.read", "agents.publish"];
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    expect(await screen.findByTestId("publish-agent-button")).toBeInTheDocument();
  });

  it("con agents.publish pero sin borrador (nada que publicar) o archivado, no aparece", async () => {
    session.permissions = ["agents.read", "agents.publish"];
    serve({ "GET /7": () => json(200, detail({ versions: [version(20, 2, { publishedAt: "2026-05-02T09:00:00Z" })] })) });
    const first = mount();
    await screen.findByTestId("agent-name");
    expect(screen.queryByTestId("publish-agent-button")).not.toBeInTheDocument();
    first.client.clear();
  });

  it("un agente archivado no se publica ni se simula", async () => {
    session.permissions = ["agents.read", "agents.publish"];
    serve({ "GET /7": () => json(200, detail({ agent: { status: "archived" } })) });
    mount();
    await screen.findByTestId("agent-name");
    expect(screen.queryByTestId("publish-agent-button")).not.toBeInTheDocument();
    expect(screen.getByTestId("simulation-unavailable")).toBeInTheDocument();
    expect(screen.queryByTestId("simulation-panel")).not.toBeInTheDocument();
  });

  it("SUPER_ADMIN publica igual que en el backend (mismo bypass que ya usa la app)", async () => {
    session.permissions = [];
    session.platformRole = "SUPER_ADMIN";
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    expect(await screen.findByTestId("publish-agent-button")).toBeInTheDocument();
  });

  it("cambiar de workspace no muestra el agente del anterior y usa la clave [agent, ws, id]", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    serve({
      "GET /7": async () => {
        if (session.orgId === 2) await gate;
        return json(200, detail({ agent: { name: session.orgId === 1 ? "Agente WS1" : "Agente WS2" } }));
      },
    });
    const { client, rerender } = mount();
    expect(await screen.findByText("Agente WS1")).toBeInTheDocument();

    session.orgId = 2;
    rerender();
    expect(screen.queryByText("Agente WS1")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-loading")).toBeInTheDocument();

    release();
    expect(await screen.findByText("Agente WS2")).toBeInTheDocument();
    expect(client.getQueryData(["agent", 1, 7])).toBeDefined();
    expect(client.getQueryData(["agent", 2, 7])).toBeDefined();
  });
});

describe("publicación", () => {
  beforeEach(() => { session.permissions = ["agents.read", "agents.publish"]; });

  async function openDialog() {
    fireEvent.click(await screen.findByTestId("publish-agent-button"));
    return screen.findByTestId("publish-confirm-button");
  }

  it("explica el cambio de estado y exige confirmación explícita: sin marcar no se llama al backend", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const confirm = await openDialog();
    expect(screen.getByText(/cambia el estado operativo/i)).toBeInTheDocument();
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(calls("POST /7/publish")).toHaveLength(0);
  });

  it("confirmada, llama a POST /:id/publish, avisa e invalida solo la lista y el detalle de este workspace", async () => {
    let published = false;
    serve({
      "GET /7": () => json(200, published
        ? detail({ agent: { activeVersionId: 30 }, versions: [version(30, 3, { publishedAt: "2026-05-03T09:00:00Z" })] })
        : detail()),
      "GET ": () => json(200, []),
      "POST /7/publish": () => { published = true; return json(200, { agent: agent(7, "Ventas", { status: "published", activeVersionId: 30 }), publishedVersionNumber: 3 }); },
    });
    const { client } = mount();
    // la lista del mismo workspace y créditos ya están en caché: solo la lista debe invalidarse
    await client.prefetchQuery({ queryKey: ["agents", 1], queryFn: async () => [] });
    client.setQueryData(["credits-balance", 1], { balance: 1, held: 0, available: 1 });
    client.setQueryData(["agents", 2], ["otro-workspace"]);
    const spy = vi.spyOn(client, "invalidateQueries");

    const confirm = await openDialog();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);

    expect(await screen.findByText("Agente publicado")).toBeInTheDocument();
    expect(calls("POST /7/publish")).toHaveLength(1);
    expect(calls("POST /7/publish")[0]![1]).toMatchObject({ method: "POST" });

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls.map(([f]) => f?.queryKey)).toEqual([["agents", 1], ["agent", 1, 7]]);
    // el detalle se vuelve a pedir y refleja la nueva versión activa
    await waitFor(() => expect(screen.getByTestId("agent-active-version")).toHaveTextContent("Versión activa: v3"));
    expect(client.getQueryState(["credits-balance", 1])?.isInvalidated).toBe(false);
    expect(client.getQueryState(["agents", 2])?.isInvalidated).toBe(false);
  });

  it("si el backend rechaza la publicación (422) muestra la lista de problemas y el diálogo sigue abierto", async () => {
    serve({
      "GET /7": () => json(200, detail()),
      "POST /7/publish": () => json(422, { error: "El agente no está listo para publicarse.", problems: ["Falta el objetivo: qué hace el agente.", "Faltan las instrucciones del agente."] }),
    });
    mount();
    const confirm = await openDialog();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(confirm);
    const problems = await screen.findByTestId("error-problems");
    expect(problems).toHaveTextContent("Falta el objetivo");
    expect(problems).toHaveTextContent("Faltan las instrucciones");
    expect(screen.getByTestId("error-technical")).toHaveTextContent("HTTP 422");
    expect(screen.getByTestId("publish-confirm-button")).toBeInTheDocument();
    expect(calls("GET /7")).toHaveLength(1);   // un rechazo no refresca nada: no cambió ningún estado
  });

  it("un 403 (permiso) se muestra como tal", async () => {
    serve({
      "GET /7": () => json(200, detail()),
      "POST /7/publish": () => json(403, { error: "permission_denied", message: "No tienes permiso (agents.publish)" }),
    });
    mount();
    const confirm = await openDialog();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(confirm);
    expect(await screen.findByText("Sin permiso")).toBeInTheDocument();
  });
});

describe("Simulation", () => {
  it("se identifica claramente como SIMULATION MODE y no ofrece ejecución real", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    expect(await screen.findByTestId("simulation-mode-badge")).toHaveTextContent("SIMULATION MODE");
    expect(screen.getByTestId("simulation-notice")).toHaveTextContent(/no consume OmniCredits/i);
    expect(screen.getByTestId("simulation-notice")).toHaveTextContent(/no ejecuta herramientas/i);
    expect(screen.queryByRole("button", { name: /live|ejecutar|run/i })).not.toBeInTheDocument();
  });

  it("simular llama a POST /:id/simulate con el mensaje y muestra la respuesta como simulada, con 0 créditos consumidos", async () => {
    serve({
      "GET /7": () => json(200, detail()),
      "POST /7/simulate": () => json(200, simulation()),
    });
    mount();
    const btn = await screen.findByTestId("simulate-button");
    expect(btn).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Mensaje de prueba"), { target: { value: "  ¿Cuánto cuesta?  " } });
    fireEvent.click(btn);

    const result = await screen.findByTestId("simulation-result");
    expect(JSON.parse((calls("POST /7/simulate")[0]![1] as RequestInit).body as string)).toEqual({ message: "¿Cuánto cuesta?" });
    expect(result).toHaveTextContent("Resultado simulado");
    expect(screen.getByTestId("simulation-reply")).toHaveTextContent("[SIMULACIÓN]");
    expect(screen.getByTestId("simulation-no-charge")).toHaveTextContent("Créditos consumidos por esta simulación: 0");
    // el importe es una estimación, nunca se presenta como consumo ni como LIVE
    expect(screen.getByTestId("simulation-estimate")).toHaveTextContent("Estimación (no es un consumo)");
    expect(screen.getByTestId("simulation-estimate")).toHaveTextContent("12,5");
    expect(result).toHaveTextContent("openai/gpt-x");
    expect(result.textContent).not.toMatch(/\bLIVE\b/);
    expect(result.textContent).not.toMatch(/\$|USD/);
    // nada de ejecución real ni de publicación desde la simulación
    expect(calls("POST /7/run")).toHaveLength(0);
    expect(calls("POST /7/publish")).toHaveLength(0);
  });

  it("muestra la acción propuesta como NO ejecutada, las herramientas excluidas y el precio provisional", async () => {
    serve({
      "GET /7": () => json(200, detail()),
      "POST /7/simulate": () => json(200, simulation({
        proposedAction: { toolId: "create_task", params: {}, requiresConfirmation: true },
        denied: [{ toolId: "send_email", reason: "Herramienta desconocida." }],
        estimate: { typicalCredits: 3, maxCredits: 9, priceKnown: false, priceSource: "fallback", provisional: true },
      })),
    });
    mount();
    fireEvent.change(await screen.findByLabelText("Mensaje de prueba"), { target: { value: "crea una tarea" } });
    fireEvent.click(screen.getByTestId("simulate-button"));
    expect(await screen.findByTestId("simulation-action")).toHaveTextContent("no se ha ejecutado");
    expect(screen.getByTestId("simulation-denied")).toHaveTextContent("send_email");
    expect(screen.getByTestId("simulation-estimate")).toHaveTextContent("Precio provisional");
  });

  it("un error de la simulación se muestra con su código", async () => {
    serve({
      "GET /7": () => json(200, detail()),
      "POST /7/simulate": () => json(409, { error: "El agente está archivado." }),
    });
    mount();
    fireEvent.change(await screen.findByLabelText("Mensaje de prueba"), { target: { value: "hola" } });
    fireEvent.click(screen.getByTestId("simulate-button"));
    expect(await screen.findByText("El agente está archivado.")).toBeInTheDocument();
    expect(screen.getByTestId("error-technical")).toHaveTextContent("HTTP 409");
    expect(screen.queryByTestId("simulation-result")).not.toBeInTheDocument();
  });

  it("solo necesita agents.read (como el backend)", async () => {
    session.permissions = ["agents.read"];
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    expect(await screen.findByTestId("simulation-panel")).toBeInTheDocument();
  });
});
