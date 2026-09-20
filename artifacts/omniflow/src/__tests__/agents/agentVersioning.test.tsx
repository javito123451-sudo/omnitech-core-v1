import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
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

import AgentDetailPage from "@/pages/agent-detail";
import { AgentVersionList } from "@/components/agents/AgentVersionList";
import { VersionDetailPanel } from "@/components/agents/VersionDetailPanel";
import { Toaster } from "@/components/ui/toaster";
import { agent, config, json, simulation, version } from "./fixtures";

type Handler = (init?: RequestInit) => Response | Promise<Response>;

const v1 = () => version(10, 1, { publishedAt: "2026-05-01T09:00:00Z", config: config({ identity: { role: "Rol de la v1" }, channels: ["web"] }) });
const v2 = () => version(20, 2, { publishedAt: "2026-05-02T09:00:00Z", config: config({ identity: { role: "Vendedor senior" }, channels: ["web", "whatsapp"] }) });
/** Borrador v3: rol distinto, una regla nueva y un canal menos que la v2. */
const v3 = () => version(30, 3, {
  notes: "Borrador de prueba",
  config: config({
    identity: { role: "Asistente comercial" }, channels: ["web"],
    behavior: { instructions: "Responde con amabilidad.", rules: ["Saluda siempre", "Regla nueva"], restrictions: ["No des precios cerrados"], avoid: ["jerga"] },
  }),
});

const detail = (over: { agent?: Record<string, unknown>; versions?: ReturnType<typeof v1>[] } = {}) => ({
  agent: agent(7, "Ventas", { status: "published", activeVersionId: 20, ...over.agent }),
  versions: over.versions ?? [v3(), v2(), v1()],
});
const noDraft = () => detail({ versions: [v2(), v1()] });

function serve(routes: Record<string, Handler>) {
  authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const path = String(url).replace(/^.*\/api\/agents/, "");
    const key = `${init?.method ?? "GET"} ${path}`;
    const h = routes[key];
    if (!h) throw new Error(`ruta no prevista en el test: ${key}`);
    return h(init);
  });
}
const keyOf = ([u, i]: unknown[]) => `${(i as RequestInit | undefined)?.method ?? "GET"} ${String(u).replace(/^.*\/api\/agents/, "")}`;
const calls = (key: string) => authFetch.mock.calls.filter((c) => keyOf(c) === key);

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

const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
const select = async (n: number) => { fireEvent.click(await screen.findByTestId(`version-select-${n}`)); return screen.findByTestId("version-detail"); };
const dialogTitle = () => screen.findByRole("dialog");

beforeEach(() => {
  authFetch.mockReset();
  session.orgId = 1;
  session.loading = false;
  session.permissions = ["agents.read", "agents.write"];
  session.platformRole = "NONE";
});

describe("Historial de versiones", () => {
  it("muestra la lista con la más reciente primero, con su estado y si es la activa o el borrador", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const list = await screen.findByTestId("versions");
    expect(within(list).getByText("Historial de versiones")).toBeInTheDocument();
    const rows = within(list).getAllByTestId(/^version-\d+$/).map((r) => r.getAttribute("data-testid"));
    expect(rows).toEqual(["version-3", "version-2", "version-1"]);
    expect(screen.getByTestId("version-3")).toHaveTextContent("Borrador");
    expect(screen.getByTestId("version-3")).toHaveTextContent("aún no publicada");
    expect(screen.getByTestId("version-2")).toHaveTextContent("Publicada");
    expect(screen.getByTestId("version-2")).toHaveTextContent("Activa");
    expect(screen.getByTestId("version-1")).not.toHaveTextContent("Activa");
  });

  it("ordena por número aunque la lista llegue desordenada", () => {
    render(<AgentVersionList agent={agent(7, "Ventas") as never} versions={[v1(), v3(), v2()]} />);
    expect(screen.getAllByTestId(/^version-\d+$/).map((r) => r.getAttribute("data-testid"))).toEqual(["version-3", "version-2", "version-1"]);
  });

  it("al seleccionar una versión se identifica y muestra SU configuración, no la actual", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const panel = await select(1);
    expect(within(panel).getByTestId("version-detail-title")).toHaveTextContent("Versión v1");
    expect(within(panel).getByTestId("version-detail-state")).toHaveTextContent("Publicada");
    expect(within(panel).getByTestId("version-config-title")).toHaveTextContent("Configuración de la v1");
    expect(within(panel).getByTestId("cfg-identity")).toHaveTextContent("Rol de la v1");
    expect(within(panel).getByTestId("cfg-identity")).not.toHaveTextContent("Vendedor senior");
    expect(within(panel).getByTestId("cfg-channels")).toHaveTextContent("Web");
    expect(within(panel).getByTestId("cfg-channels")).not.toHaveTextContent("WhatsApp");
    expect(screen.getByTestId("version-1")).toHaveAttribute("data-selected", "true");
    expect(screen.getByTestId("version-2")).toHaveAttribute("data-selected", "false");
  });

  it("muestra todas las secciones de la configuración de la versión", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const panel = await select(2);
    for (const id of ["cfg-identity", "cfg-personality", "cfg-behavior", "cfg-model", "cfg-tools", "cfg-channels"]) {
      expect(within(panel).getByTestId(id)).toBeInTheDocument();
    }
    expect(within(panel).getByTestId("cfg-behavior")).toHaveTextContent("Taller mecánico en Valencia");
  });

  it("una versión publicada dice que está congelada; «Volver al historial» cierra el detalle", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const panel = await select(2);
    expect(panel).toHaveTextContent("congelada");
    fireEvent.click(within(panel).getByTestId("version-detail-close"));
    expect(screen.queryByTestId("version-detail")).not.toBeInTheDocument();
    expect(screen.getByTestId("versions")).toBeInTheDocument();
  });

  it("una versión inexistente muestra «Versión no encontrada» y permite volver", () => {
    const onClose = vi.fn();
    render(<VersionDetailPanel agent={agent(7, "Ventas") as never} versions={[v2(), v1()]} selectedId={999} canRestore={false} hasUnsavedEdits={false} onClose={onClose} onRestored={() => undefined} />);
    expect(screen.getByTestId("version-not-found")).toHaveTextContent("La versión seleccionada no existe");
    fireEvent.click(screen.getByRole("button", { name: "Volver al historial" }));
    expect(onClose).toHaveBeenCalled();
  });

  it("compara por defecto con la versión inmediatamente anterior y se puede cambiar", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const panel = await select(3);
    expect(within(panel).getByTestId("diff-summary")).toHaveTextContent("v2 → v3");
    fireEvent.change(within(panel).getByTestId("compare-select"), { target: { value: "10" } });
    expect(within(panel).getByTestId("diff-summary")).toHaveTextContent("v1 → v3");
    fireEvent.change(within(panel).getByTestId("compare-select"), { target: { value: "" } });
    expect(within(panel).getByTestId("diff-no-base")).toBeInTheDocument();
  });

  it("la primera versión no tiene con qué compararse por defecto", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const panel = await select(1);
    expect(within(panel).getByTestId("compare-select")).toHaveValue("");
    expect(within(panel).getByTestId("diff-no-base")).toBeInTheDocument();
  });
});

describe("Comparación en pantalla", () => {
  it("muestra los cambios reales por sección (modificado, lista añadida, canal eliminado) y «Sin cambios» en el resto", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const panel = await select(3);
    const identity = within(panel).getByTestId("diff-section-identity");
    expect(within(identity).getByTestId("diff-before")).toHaveTextContent("Vendedor senior");
    expect(within(identity).getByTestId("diff-after")).toHaveTextContent("Asistente comercial");
    const behavior = within(panel).getByTestId("diff-section-behavior");
    expect(within(behavior).getByTestId("diff-item-added")).toHaveTextContent("+ Regla nueva");
    const channels = within(panel).getByTestId("diff-section-channels");
    expect(within(channels).getByTestId("diff-item-removed")).toHaveTextContent("− WhatsApp");
    expect(within(panel).getByTestId("diff-empty-objective")).toHaveTextContent("Sin cambios");
    expect(within(panel).getByTestId("diff-empty-personality")).toBeInTheDocument();
    expect(within(panel).getByTestId("diff-summary")).toHaveTextContent("3 cambios");
  });

  it("dos versiones iguales: «Sin cambios»", async () => {
    const same = [version(30, 3), version(20, 2, { publishedAt: "2026-05-02T09:00:00Z" })];
    serve({ "GET /7": () => json(200, detail({ versions: same })) });
    mount();
    const panel = await select(3);
    expect(within(panel).getByTestId("diff-summary")).toHaveTextContent("Sin cambios");
  });
});

describe("Borrador", () => {
  it("se identifica como BORRADOR sin publicar y ofrece abrir, editar y simular", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const card = await screen.findByTestId("draft-card");
    expect(within(card).getByTestId("draft-badge")).toHaveTextContent("BORRADOR");
    expect(within(card).getByTestId("draft-notice")).toHaveTextContent("Esta versión todavía no está publicada.");
    expect(within(card).getByTestId("draft-open")).toBeInTheDocument();
    expect(within(card).getByTestId("draft-edit")).toBeInTheDocument();
    expect(within(card).getByTestId("draft-simulate")).toBeInTheDocument();
  });

  it("«Abrir» selecciona el borrador en el historial, con su aviso de no publicado; se puede volver al historial", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    fireEvent.click(await screen.findByTestId("draft-open"));
    const panel = await screen.findByTestId("version-detail");
    expect(within(panel).getByTestId("version-detail-state")).toHaveTextContent("BORRADOR");
    expect(within(panel).getByTestId("version-detail-unpublished")).toHaveTextContent("Esta versión todavía no está publicada.");
    fireEvent.click(within(panel).getByTestId("version-detail-close"));
    expect(screen.queryByTestId("version-detail")).not.toBeInTheDocument();
  });

  it("«Editar» abre la pestaña del editor", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    fireEvent.click(await screen.findByTestId("draft-edit"));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Editar borrador" })).toHaveAttribute("data-state", "active"));
  });

  it("«Simular» lleva al campo de la simulación", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    fireEvent.click(await screen.findByTestId("draft-simulate"));
    expect(document.activeElement).toBe(screen.getByLabelText("Mensaje de prueba"));
  });

  it("sin permiso de escritura no se ofrece «Editar»", async () => {
    session.permissions = ["agents.read", "agents.publish"];
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    await screen.findByTestId("draft-card");
    expect(screen.queryByTestId("draft-edit")).not.toBeInTheDocument();
    expect(screen.getByTestId("draft-open")).toBeInTheDocument();
  });

  it("sin borrador lo dice: la versión publicada no se edita, se crea un borrador al guardar", async () => {
    serve({ "GET /7": () => json(200, noDraft()) });
    mount();
    expect(await screen.findByTestId("draft-card-empty")).toHaveTextContent("No hay borrador");
    expect(screen.queryByTestId("draft-review")).not.toBeInTheDocument();
  });

  it("la revisión enseña qué cambia el borrador respecto a la versión activa", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const review = await screen.findByTestId("draft-review");
    expect(review).toHaveTextContent("borrador v3 respecto a la v2");
    expect(within(review).getByTestId("diff-summary")).toHaveTextContent("v2 → v3: 3 cambios");
    expect(screen.getByTestId("flow-step-review")).toHaveTextContent("3 cambios respecto a la v2");
  });

  it("el recorrido BORRADOR → SIMULACIÓN → REVISIÓN → PUBLICACIÓN refleja el estado real", async () => {
    serve({ "GET /7": () => json(200, detail()) , "POST /7/simulate": () => json(200, simulation()) });
    mount();
    const flow = await screen.findByTestId("versioning-flow");
    expect(within(flow).getByTestId("flow-step-draft")).toHaveAttribute("data-state", "done");
    expect(within(flow).getByTestId("flow-step-simulation")).toHaveAttribute("data-state", "pending");
    type(screen.getByLabelText("Mensaje de prueba"), "hola");
    fireEvent.click(screen.getByTestId("simulate-button"));
    await screen.findByTestId("simulation-result");
    expect(within(flow).getByTestId("flow-step-simulation")).toHaveAttribute("data-state", "done");
  });
});

describe("Restaurar en borrador", () => {
  const restoreOk = () => json(200, version(30, 3, { notes: "Restaurada desde la versión 2", config: config({ identity: { role: "Vendedor senior" } }) }));

  it("con agents.write aparece en las versiones publicadas, pero no en el propio borrador", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const published = await select(2);
    expect(within(published).getByTestId("restore-button")).toBeInTheDocument();
    const draftPanel = await select(3);
    expect(within(draftPanel).queryByTestId("restore-button")).not.toBeInTheDocument();
  });

  it("agents.read + agents.publish: puede ver y publicar, pero NO editar ni restaurar", async () => {
    session.permissions = ["agents.read", "agents.publish"];
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const panel = await select(2);
    expect(within(panel).queryByTestId("restore-button")).not.toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Editar borrador" })).not.toBeInTheDocument();
    expect(screen.getByTestId("publish-agent-button")).toBeInTheDocument();
  });

  it("solo agents.read: sin restaurar", async () => {
    session.permissions = ["agents.read"];
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const panel = await select(2);
    expect(within(panel).queryByTestId("restore-button")).not.toBeInTheDocument();
  });

  it("SUPER_ADMIN restaura con el mismo bypass de siempre", async () => {
    session.permissions = [];
    session.platformRole = "SUPER_ADMIN";
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const panel = await select(2);
    expect(within(panel).getByTestId("restore-button")).toBeInTheDocument();
  });

  it("agente archivado: no se restaura (el backend responde 409)", async () => {
    serve({ "GET /7": () => json(200, detail({ agent: { status: "archived" } })) });
    mount();
    const panel = await select(2);
    expect(within(panel).queryByTestId("restore-button")).not.toBeInTheDocument();
  });

  it("pide confirmación explicando que reemplaza el borrador; cancelar no llama al backend", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    const panel = await select(2);
    fireEvent.click(within(panel).getByTestId("restore-button"));
    const dlg = await dialogTitle();
    expect(within(dlg).getByTestId("restore-explanation")).toHaveTextContent("Esto reemplazará el contenido del borrador actual (v3) por esta versión.");
    expect(dlg).toHaveTextContent("no se modifican");
    expect(dlg).toHaveTextContent("No se publica nada");
    expect(calls("POST /7/versions/20/restore")).toHaveLength(0);
    fireEvent.click(within(dlg).getByTestId("restore-cancel-button"));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(calls("POST /7/versions/20/restore")).toHaveLength(0);
  });

  it("sin borrador dice que se creará uno nuevo", async () => {
    serve({ "GET /7": () => json(200, noDraft()) });
    mount();
    const panel = await select(2);
    fireEvent.click(within(panel).getByTestId("restore-button"));
    expect(await screen.findByTestId("restore-explanation")).toHaveTextContent("se creará uno nuevo");
  });

  it("avisa si hay cambios sin guardar en el editor", async () => {
    serve({ "GET /7": () => json(200, detail()) });
    mount();
    type(await screen.findByLabelText("Rol"), "Editando…");
    const panel = await select(2);
    fireEvent.click(within(panel).getByTestId("restore-button"));
    expect(await screen.findByTestId("restore-unsaved-warning")).toBeInTheDocument();
  });

  it("confirmado: POST restore, avisa, selecciona el borrador resultante e invalida solo este agente y su lista", async () => {
    serve({ "GET /7": () => json(200, detail()), "POST /7/versions/20/restore": restoreOk });
    const { client } = mount();
    const panel = await select(2);
    client.setQueryData(["agents", 2], ["otro"]);
    client.setQueryData(["credits-balance", 1], { balance: 1, held: 0, available: 1 });
    const spy = vi.spyOn(client, "invalidateQueries");

    fireEvent.click(within(panel).getByTestId("restore-button"));
    fireEvent.click(await screen.findByTestId("restore-confirm-button"));

    expect(await screen.findByText("Versión restaurada en el borrador")).toBeInTheDocument();
    expect(calls("POST /7/versions/20/restore")).toHaveLength(1);
    expect((calls("POST /7/versions/20/restore")[0]![1] as RequestInit).body).toBeUndefined();
    await waitFor(() => expect(screen.getByTestId("version-detail")).toHaveAttribute("data-version-id", "30"));
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls.map(([f]) => f?.queryKey)).toEqual([["agent", 1, 7], ["agents", 1]]);
    expect(client.getQueryState(["agents", 2])?.isInvalidated).toBe(false);
    expect(client.getQueryState(["credits-balance", 1])?.isInvalidated).toBe(false);
    await waitFor(() => expect(calls("GET /7").length).toBeGreaterThanOrEqual(2));   // detalle y versiones refrescados
    // nada de publicar ni de ejecutar
    expect(calls("POST /7/publish")).toHaveLength(0);
    expect(calls("POST /7/run")).toHaveLength(0);
  });

  it.each([
    [403, { error: "permission_denied", message: "No tienes permiso (agents.write)" }, "Sin permiso"],
    [404, { error: "Versión no encontrada." }, "Versión no encontrada."],
    [409, { error: "El agente está archivado y no se puede modificar." }, "El agente está archivado"],
  ])("HTTP %i se muestra con su código y el diálogo sigue abierto", async (status, body, text) => {
    serve({ "GET /7": () => json(200, detail()), "POST /7/versions/20/restore": () => json(status, body) });
    mount();
    const panel = await select(2);
    fireEvent.click(within(panel).getByTestId("restore-button"));
    fireEvent.click(await screen.findByTestId("restore-confirm-button"));
    const dlg = await dialogTitle();
    expect(await within(dlg).findByTestId("error-technical")).toHaveTextContent(`HTTP ${status}`);
    expect(dlg).toHaveTextContent(text);
    expect(within(dlg).getByTestId("restore-confirm-button")).toBeEnabled();
  });
});

describe("Simulación obsoleta", () => {
  async function simulateOnce() {
    type(await screen.findByLabelText("Mensaje de prueba"), "hola");
    fireEvent.click(screen.getByTestId("simulate-button"));
    return screen.findByTestId("simulation-result");
  }

  it("una simulación vale para la configuración actual: lo dice y a qué versión corresponde", async () => {
    serve({ "GET /7": () => json(200, detail()), "POST /7/simulate": () => json(200, simulation()) });
    mount();
    expect(await screen.findByTestId("simulation-target")).toHaveTextContent("Se simula el borrador v3");
    const result = await simulateOnce();
    expect(within(result).getByTestId("simulation-current")).toHaveTextContent("Corresponde a el borrador v3");
    expect(screen.queryByTestId("simulation-stale")).not.toBeInTheDocument();
  });

  it("guardar el borrador descarta la simulación anterior y avisa de que hay que repetirla", async () => {
    serve({
      "GET /7": () => json(200, detail()),
      "PUT /7/draft": () => json(200, version(30, 3, { config: config({ identity: { role: "Vendedor" } }) })),
      "POST /7/simulate": () => json(200, simulation()),
    });
    mount();
    await simulateOnce();
    type(screen.getByLabelText("Rol"), "Vendedor");
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(await screen.findByTestId("simulation-stale")).toHaveTextContent("Se requiere una nueva simulación");
    expect(screen.queryByTestId("simulation-result")).not.toBeInTheDocument();
    expect(screen.getByTestId("flow-step-simulation")).toHaveAttribute("data-state", "pending");
  });

  it("después de guardar se puede volver a simular y el resultado nuevo es el actual", async () => {
    serve({
      "GET /7": () => json(200, detail()),
      "PUT /7/draft": () => json(200, version(30, 3)),
      "POST /7/simulate": () => json(200, simulation()),
    });
    mount();
    await simulateOnce();
    type(screen.getByLabelText("Rol"), "Vendedor");
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("simulation-stale");
    fireEvent.click(screen.getByTestId("simulate-button"));
    await screen.findByTestId("simulation-result");
    expect(screen.queryByTestId("simulation-stale")).not.toBeInTheDocument();
    expect(calls("POST /7/simulate")).toHaveLength(2);
  });

  it("restaurar una versión descarta la simulación anterior", async () => {
    serve({
      "GET /7": () => json(200, detail()),
      "POST /7/versions/20/restore": () => json(200, version(30, 3, { config: config({ identity: { role: "Vendedor senior" } }) })),
      "POST /7/simulate": () => json(200, simulation()),
    });
    mount();
    await simulateOnce();
    const panel = await select(2);
    fireEvent.click(within(panel).getByTestId("restore-button"));
    fireEvent.click(await screen.findByTestId("restore-confirm-button"));
    expect(await screen.findByTestId("simulation-stale")).toBeInTheDocument();
    expect(screen.queryByTestId("simulation-result")).not.toBeInTheDocument();
  });

  it("una simulación que termina DESPUÉS de cambiar el borrador nunca se muestra como actual", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    serve({
      "GET /7": () => json(200, detail()),
      "PUT /7/draft": () => json(200, version(30, 3)),
      "POST /7/simulate": async () => { await gate; return json(200, simulation()); },
    });
    mount();
    type(await screen.findByLabelText("Mensaje de prueba"), "hola");
    fireEvent.click(screen.getByTestId("simulate-button"));            // en vuelo
    type(screen.getByLabelText("Rol"), "Vendedor");
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    release();
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("simulation-result")).not.toBeInTheDocument();
  });

  it("guardar solo el nombre (que aparece en la respuesta simulada) también invalida cuando llega el detalle nuevo; nunca se llama a /run", async () => {
    let renamed = false;
    serve({
      "GET /7": () => json(200, { ...detail(), agent: agent(7, renamed ? "Ventas 2" : "Ventas", { status: "published", activeVersionId: 20 }) }),
      "PATCH /7": () => { renamed = true; return json(200, agent(7, "Ventas 2")); },
      "POST /7/simulate": () => json(200, simulation()),
    });
    mount();
    await simulateOnce();
    type(screen.getByLabelText("Nombre"), "Ventas 2");
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(await screen.findByTestId("simulation-stale")).toBeInTheDocument();
    expect(screen.queryByTestId("simulation-result")).not.toBeInTheDocument();
    expect(calls("POST /7/run")).toHaveLength(0);
  });
});

describe("Publicar", () => {
  it("con agents.publish (sin write) ve el resumen del borrador, el aviso de que quedará congelado y sigue necesitando confirmación", async () => {
    session.permissions = ["agents.read", "agents.publish"];
    serve({ "GET /7": () => json(200, detail()), "POST /7/publish": () => json(200, { agent: agent(7, "Ventas"), publishedVersionNumber: 3 }) });
    mount();
    fireEvent.click(await screen.findByTestId("publish-agent-button"));
    const summary = await screen.findByTestId("publish-summary");
    expect(summary).toHaveTextContent("Se publicará la versión v3 (estado: borrador)");
    expect(summary).toHaveTextContent("Asistente comercial");
    expect(summary).toHaveTextContent("Atender consultas de clientes");
    expect(screen.getByTestId("publish-changes")).toHaveTextContent("3 cambios respecto a la v2");
    expect(screen.getByTestId("publish-warning")).toHaveTextContent("quedará congelada");
    const confirm = screen.getByTestId("publish-confirm-button");
    expect(confirm).toBeDisabled();
    fireEvent.click(confirm);
    expect(calls("POST /7/publish")).toHaveLength(0);
  });

  it("restaurar nunca publica: el flujo termina en un borrador, sin llamadas a publish", async () => {
    serve({
      "GET /7": () => json(200, detail()),
      "POST /7/versions/10/restore": () => json(200, version(30, 3)),
    });
    mount();
    const panel = await select(1);
    fireEvent.click(within(panel).getByTestId("restore-button"));
    fireEvent.click(await screen.findByTestId("restore-confirm-button"));
    await screen.findByText("Versión restaurada en el borrador");
    expect(calls("POST /7/publish")).toHaveLength(0);
  });
});

describe("Workspace", () => {
  it("cada workspace tiene su propio detalle: la versión seleccionada y los datos del anterior no se mezclan", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    serve({
      "GET /7": async () => {
        if (session.orgId === 2) await gate;
        return json(200, session.orgId === 1
          ? detail()
          : { agent: agent(7, "Agente WS2", { status: "draft" }), versions: [version(50, 1, { config: config({ identity: { role: "Rol WS2" } }) })] });
      },
    });
    const { client, rerender } = mount();
    await select(2);

    session.orgId = 2;
    rerender();
    expect(screen.queryByTestId("version-detail")).not.toBeInTheDocument();
    expect(screen.queryByTestId("versions")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-loading")).toBeInTheDocument();

    release();
    expect(await screen.findByText("Agente WS2")).toBeInTheDocument();
    const list = screen.getByTestId("versions");
    expect(within(list).getAllByTestId(/^version-\d+$/)).toHaveLength(1);
    expect(screen.queryByText(/Vendedor senior/)).not.toBeInTheDocument();
    expect(client.getQueryData(["agent", 1, 7])).toBeDefined();
    expect(client.getQueryData(["agent", 2, 7])).toBeDefined();
  });
});
