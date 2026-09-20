import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
import { Toaster } from "@/components/ui/toaster";
import { agent, config, json, simulation, version } from "./fixtures";

type Handler = (init?: RequestInit) => Response | Promise<Response>;

/** Agente publicado (v2 activa) con un borrador v3 cuyo rol es «Asistente comercial» (el de la v2 es «Vendedor senior»). */
const withDraft = (over: { agent?: Record<string, unknown> } = {}) => ({
  agent: agent(7, "Ventas", { status: "published", activeVersionId: 20, ...over.agent }),
  versions: [
    version(30, 3),
    version(20, 2, { publishedAt: "2026-05-02T09:00:00Z", config: config({ identity: { role: "Vendedor senior" } }) }),
    version(10, 1, { publishedAt: "2026-05-01T09:00:00Z" }),
  ],
});
/** Sin borrador: solo versiones publicadas. */
const noDraft = (status = "published") => ({
  agent: agent(7, "Ventas", { status: status as never, activeVersionId: 20 }),
  versions: [
    version(20, 2, { publishedAt: "2026-05-02T09:00:00Z", config: config({ identity: { role: "Vendedor senior" } }) }),
    version(10, 1, { publishedAt: "2026-05-01T09:00:00Z" }),
  ],
});

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
const body = (key: string, n = 0) => JSON.parse((calls(key)[n]![1] as RequestInit).body as string);

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

const field = (label: string) => screen.findByLabelText(label) as Promise<HTMLInputElement | HTMLTextAreaElement>;
const type = (el: HTMLElement, value: string) => fireEvent.change(el, { target: { value } });
async function openEditor() {
  const tab = await screen.findByRole("tab", { name: "Editar borrador" });
  fireEvent.mouseDown(tab, { button: 0 });
}

beforeEach(() => {
  authFetch.mockReset();
  session.orgId = 1;
  session.loading = false;
  session.permissions = ["agents.read", "agents.write"];
  session.platformRole = "NONE";
});

describe("Builder — permisos", () => {
  it("agents.read solo ve la configuración: no hay pestaña de edición ni formulario", async () => {
    session.permissions = ["agents.read"];
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    await screen.findByTestId("agent-name");
    expect(screen.queryByRole("tab", { name: "Editar borrador" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("config-form")).not.toBeInTheDocument();
    expect(screen.getByText("Vista de solo lectura de la configuración.")).toBeInTheDocument();
  });

  it("agents.write puede editar", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    expect(await screen.findByRole("tab", { name: "Editar borrador" })).toBeInTheDocument();
    expect(screen.getByTestId("config-form")).toBeInTheDocument();
  });

  it("agents.publish NO implica agents.write: sin write no hay editor (aunque sí «Publicar»)", async () => {
    session.permissions = ["agents.read", "agents.publish"];
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    expect(await screen.findByTestId("publish-agent-button")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Editar borrador" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("config-form")).not.toBeInTheDocument();
  });

  it("agents.write NO implica agents.publish: se edita pero no se publica", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    await screen.findByRole("tab", { name: "Editar borrador" });
    expect(screen.queryByTestId("publish-agent-button")).not.toBeInTheDocument();
  });

  it("SUPER_ADMIN edita con el mismo bypass que ya usa la app", async () => {
    session.permissions = [];
    session.platformRole = "SUPER_ADMIN";
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    expect(await screen.findByRole("tab", { name: "Editar borrador" })).toBeInTheDocument();
  });
});

describe("Builder — estados del agente", () => {
  it("draft: editable", async () => {
    serve({ "GET /7": () => json(200, { agent: agent(7, "Ventas", { status: "draft" }), versions: [version(30, 1)] }) });
    mount();
    expect(await screen.findByRole("tab", { name: "Editar borrador" })).toBeInTheDocument();
    expect(screen.getByTestId("builder-target")).toHaveTextContent("Editando el borrador v1");
  });

  it("published: editable, y sin borrador dice que se creará una versión nueva sin tocar la publicada", async () => {
    serve({ "GET /7": () => json(200, noDraft("published")) });
    mount();
    expect(await screen.findByTestId("builder-target")).toHaveTextContent("se creará la versión v3 como borrador; la versión publicada no cambia");
  });

  it("paused: editable con las mismas reglas del backend (crea/actualiza un borrador)", async () => {
    serve({ "GET /7": () => json(200, noDraft("paused")) });
    mount();
    expect(await screen.findByRole("tab", { name: "Editar borrador" })).toBeInTheDocument();
    expect(screen.getByTestId("builder-target")).toHaveTextContent("v3");
  });

  it("archived: no se edita (el backend responde 409) y se explica", async () => {
    serve({ "GET /7": () => json(200, noDraft("archived")) });
    mount();
    expect(await screen.findByTestId("edit-unavailable")).toHaveTextContent("archivado");
    expect(screen.queryByRole("tab", { name: "Editar borrador" })).not.toBeInTheDocument();
    expect(screen.queryByTestId("config-form")).not.toBeInTheDocument();
  });
});

describe("Builder — formulario", () => {
  it("los valores iniciales salen del BORRADOR (no de la versión activa)", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    expect((await field("Rol")).value).toBe("Asistente comercial");
    expect((await field("Nombre")).value).toBe("Ventas");
    expect((await field("Qué hace el agente")).value).toBe("Atender consultas de clientes");
    expect((await field("Instrucciones")).value).toBe("Responde con amabilidad.");
    expect((await field("Temperatura")).value).toBe("0.4");
    expect((screen.getByLabelText("Web") as HTMLElement).getAttribute("data-state")).toBe("checked");
    expect((screen.getByLabelText("Telegram") as HTMLElement).getAttribute("data-state")).toBe("unchecked");
  });

  it("sin borrador parte de la última versión (la misma base que usa el backend)", async () => {
    serve({ "GET /7": () => json(200, noDraft()) });
    mount();
    expect((await field("Rol")).value).toBe("Vendedor senior");
  });

  it("limpio: guardar deshabilitado, sin barra de cambios; al editar aparece el estado sin guardar", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    await field("Rol");
    expect(screen.getByTestId("save-draft-button")).toBeDisabled();
    expect(screen.queryByTestId("unsaved-bar")).not.toBeInTheDocument();
    type(await field("Rol"), "Vendedor");
    expect(screen.getByTestId("dirty-indicator")).toBeInTheDocument();
    expect(screen.getByTestId("unsaved-bar")).toBeInTheDocument();
    expect(screen.getByTestId("save-draft-button")).toBeEnabled();
  });

  it("volver a escribir el valor original deja de ser «sin guardar»", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    type(await field("Rol"), "Otro");
    expect(screen.getByTestId("unsaved-bar")).toBeInTheDocument();
    type(await field("Rol"), "Asistente comercial");
    expect(screen.queryByTestId("unsaved-bar")).not.toBeInTheDocument();
  });

  it("Cancelar / reset vuelve al último estado cargado (no restaura ninguna versión) y no llama a la API", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    type(await field("Rol"), "Otro");
    type(await field("Nombre"), "Otro nombre");
    fireEvent.click(screen.getByTestId("cancel-button"));
    expect((await field("Rol")).value).toBe("Asistente comercial");
    expect((await field("Nombre")).value).toBe("Ventas");
    expect(screen.queryByTestId("unsaved-bar")).not.toBeInTheDocument();
    expect(authFetch).toHaveBeenCalledTimes(1);   // solo el GET inicial
  });

  it("la validación local bloquea el guardado y marca el campo, sin llamar al backend", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    type(await field("Temperatura"), "5");
    fireEvent.click(screen.getByTestId("save-draft-button"));
    expect(await screen.findByTestId("error-f-temperature")).toHaveTextContent("entre 0 y 2");
    expect(calls("PUT /7/draft")).toHaveLength(0);
  });

  it("el nombre vacío no se puede guardar", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    type(await field("Nombre"), "  ");
    fireEvent.click(screen.getByTestId("save-draft-button"));
    expect(await screen.findByTestId("error-f-name")).toBeInTheDocument();
    expect(calls("PATCH /7")).toHaveLength(0);
  });
});

describe("Builder — guardar", () => {
  it("un cambio de configuración hace PUT /:id/draft con SOLO la sección modificada, refresca el detalle y avisa (borrador actualizado)", async () => {
    let saved = false;
    serve({
      "GET /7": () => json(200, saved ? { ...withDraft(), versions: [version(30, 3, { config: config({ identity: { role: "Vendedor" } }) }), ...withDraft().versions.slice(1)] } : withDraft()),
      "PUT /7/draft": () => { saved = true; return json(200, version(30, 3, { config: config({ identity: { role: "Vendedor" } }) })); },
    });
    mount();
    type(await field("Rol"), "  Vendedor ");
    fireEvent.click(screen.getByTestId("save-draft-button"));

    expect(await screen.findByTestId("save-result")).toHaveTextContent("Borrador v3 actualizado.");
    expect(body("PUT /7/draft")).toEqual({ config: { identity: { role: "Vendedor" } } });
    expect(calls("PATCH /7")).toHaveLength(0);
    await waitFor(() => expect(calls("GET /7").length).toBeGreaterThanOrEqual(2));   // detalle refrescado
    expect(screen.queryByTestId("unsaved-bar")).not.toBeInTheDocument();
    expect((await field("Rol")).value).toBe("Vendedor");
    expect(calls("POST /7/run")).toHaveLength(0);
    expect(calls("POST /7/publish")).toHaveLength(0);
  });

  it("sin borrador previo el backend crea una versión nueva y la UI lo dice", async () => {
    serve({
      "GET /7": () => json(200, noDraft()),
      "PUT /7/draft": () => json(200, version(31, 3, { config: config({ businessContext: "Nuevo" }) })),
    });
    mount();
    type(await field("Contexto del negocio"), "Nuevo");
    fireEvent.click(screen.getByTestId("save-draft-button"));
    expect(await screen.findByTestId("save-result")).toHaveTextContent("Nueva versión v3 creada como borrador.");
    expect(body("PUT /7/draft")).toEqual({ config: { businessContext: "Nuevo" } });
  });

  it("nombre y descripción van por PATCH /:id con solo lo cambiado; sin cambios de configuración no hay PUT", async () => {
    serve({
      "GET /7": () => json(200, withDraft()),
      "PATCH /7": () => json(200, agent(7, "Ventas 2")),
    });
    mount();
    type(await field("Nombre"), "Ventas 2");
    fireEvent.click(screen.getByTestId("save-draft-button"));
    expect(await screen.findByTestId("save-result")).toHaveTextContent("Datos del agente guardados.");
    expect(body("PATCH /7")).toEqual({ name: "Ventas 2" });
    expect(calls("PUT /7/draft")).toHaveLength(0);
  });

  it("si cambian ambos: primero PUT (configuración) y luego PATCH", async () => {
    const order: string[] = [];
    serve({
      "GET /7": () => json(200, withDraft()),
      "PUT /7/draft": () => { order.push("PUT"); return json(200, version(30, 3)); },
      "PATCH /7": () => { order.push("PATCH"); return json(200, agent(7, "Ventas 2")); },
    });
    mount();
    type(await field("Nombre"), "Ventas 2");
    type(await field("Rol"), "Vendedor");
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(order).toEqual(["PUT", "PATCH"]);
  });

  it("bloquea el doble envío: dos pulsaciones seguidas = una sola petición, y el botón muestra «Guardando…»", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    serve({
      "GET /7": () => json(200, withDraft()),
      "PUT /7/draft": async () => { await gate; return json(200, version(30, 3)); },
    });
    mount();
    type(await field("Rol"), "Vendedor");
    const form = screen.getByTestId("config-form");
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(screen.getByTestId("save-draft-button")).toHaveTextContent("Guardando…"));
    expect(screen.getByTestId("save-draft-button")).toBeDisabled();
    expect(calls("PUT /7/draft")).toHaveLength(1);
    release();
    await screen.findByTestId("save-result");
    expect(calls("PUT /7/draft")).toHaveLength(1);
  });

  it("guardar parcial: la configuración se guardó y el PATCH falló → se dice qué quedó pendiente y se conserva el nombre editado", async () => {
    serve({
      "GET /7": () => json(200, withDraft()),
      "PUT /7/draft": () => json(200, version(30, 3)),
      "PATCH /7": () => json(409, { error: "El agente está archivado y no se puede modificar." }),
    });
    mount();
    type(await field("Nombre"), "Otro nombre");
    type(await field("Rol"), "Vendedor");
    fireEvent.click(screen.getByTestId("save-draft-button"));
    expect(await screen.findByText("Guardado a medias")).toBeInTheDocument();
    expect(screen.getByTestId("error-technical")).toHaveTextContent("HTTP 409");
    expect((await field("Nombre")).value).toBe("Otro nombre");
    expect(screen.getByTestId("unsaved-bar")).toBeInTheDocument();      // el nombre sigue pendiente
  });
});

describe("Builder — errores del backend", () => {
  async function failWith(status: number, resBody: unknown) {
    serve({ "GET /7": () => json(200, withDraft()), "PUT /7/draft": () => json(status, resBody) });
    mount();
    type(await field("Rol"), "Vendedor");
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-error");
  }

  it("400 con incidencias: el error sale bajo el campo correspondiente y los cambios no se pierden", async () => {
    await failWith(400, { error: "Configuración no válida.", issues: [{ path: ["identity", "role"], message: "Demasiado largo" }, { path: ["model", "x"], message: "raro" }] });
    expect(screen.getByTestId("error-f-role")).toHaveTextContent("Demasiado largo");
    expect(screen.getByTestId("error-technical")).toHaveTextContent("HTTP 400");
    expect(screen.getByTestId("error-issues")).toHaveTextContent("model.x: raro");
    expect((await field("Rol")).value).toBe("Vendedor");
    expect(screen.getByTestId("unsaved-bar")).toBeInTheDocument();
  });

  it("al volver a editar el campo con error, ese error desaparece", async () => {
    await failWith(400, { error: "Configuración no válida.", issues: [{ path: ["identity", "role"], message: "Demasiado largo" }] });
    type(await field("Rol"), "Vend");
    expect(screen.queryByTestId("error-f-role")).not.toBeInTheDocument();
  });

  it.each([
    [403, { error: "permission_denied", message: "No tienes permiso (agents.write)" }, "Sin permiso"],
    [404, { error: "Agente no encontrado." }, "Agente no encontrado."],
    [409, { error: "El agente está archivado y no se puede modificar." }, "El agente está archivado"],
    [422, { error: "Configuración incompleta." }, "Datos no válidos"],
    [429, { error: "too many" }, "HTTP 429"],
  ])("HTTP %i se muestra con su código y el borrador editado se conserva", async (status, resBody, text) => {
    await failWith(status, resBody);
    expect(screen.getByTestId("save-error")).toHaveTextContent(text);
    expect(screen.getByTestId("error-technical")).toHaveTextContent(`HTTP ${status}`);
    expect((await field("Rol")).value).toBe("Vendedor");
    expect(screen.getByTestId("save-draft-button")).toBeEnabled();     // se puede reintentar
  });
});

describe("Builder — salir con cambios sin guardar", () => {
  it("al pulsar un enlace de la app con cambios pide confirmación; «Seguir editando» conserva todo", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    const { loc } = mount();
    type(await field("Rol"), "Vendedor");
    fireEvent.click(screen.getByRole("link", { name: /agentes/i }));
    expect(await screen.findByTestId("unsaved-dialog")).toHaveTextContent("cambios sin guardar");
    fireEvent.click(screen.getByTestId("unsaved-stay"));
    await waitFor(() => expect(screen.queryByTestId("unsaved-dialog")).not.toBeInTheDocument());
    expect(loc.history!.at(-1)).toBe("/agents/7");
    expect((await field("Rol")).value).toBe("Vendedor");
  });

  it("«Salir sin guardar» navega", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    const { loc } = mount();
    type(await field("Rol"), "Vendedor");
    fireEvent.click(screen.getByRole("link", { name: /agentes/i }));
    fireEvent.click(await screen.findByTestId("unsaved-leave"));
    await waitFor(() => expect(loc.history!.at(-1)).toBe("/agents"));
  });

  it("sin cambios se navega directamente, sin diálogo", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    const { loc } = mount();
    await field("Rol");
    fireEvent.click(screen.getByRole("link", { name: /agentes/i }));
    await waitFor(() => expect(loc.history!.at(-1)).toBe("/agents"));
    expect(screen.queryByTestId("unsaved-dialog")).not.toBeInTheDocument();
  });

  it("con cambios registra el aviso nativo al cerrar la pestaña, y lo quita al guardarlos/cancelarlos", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    type(await field("Rol"), "Vendedor");
    const ev = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    fireEvent.click(screen.getByTestId("cancel-button"));
    const ev2 = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(ev2);
    expect(ev2.defaultPrevented).toBe(false);
  });

  it("cambiar de pestaña a «Configuración actual» no pierde lo escrito", async () => {
    serve({ "GET /7": () => json(200, withDraft()) });
    mount();
    type(await field("Rol"), "Vendedor");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Configuración actual" }), { button: 0 });
    await openEditor();
    expect((await field("Rol")).value).toBe("Vendedor");
    expect(screen.getByTestId("unsaved-bar")).toBeInTheDocument();
  });
});

describe("Builder — workspace", () => {
  it("cada workspace tiene su clave [agent, ws, id] y el formulario no arrastra datos ni cambios del anterior", async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    serve({
      "GET /7": async () => {
        if (session.orgId === 2) await gate;
        return json(200, { agent: agent(7, session.orgId === 1 ? "Agente WS1" : "Agente WS2", { status: "draft" }), versions: [version(30, 1)] });
      },
    });
    const { client, rerender } = mount();
    type(await field("Nombre"), "Agente WS1 editado");
    expect((await field("Nombre")).value).toBe("Agente WS1 editado");

    session.orgId = 2;
    rerender();
    expect(screen.queryByTestId("config-form")).not.toBeInTheDocument();
    expect(screen.getByTestId("agent-loading")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("Agente WS1 editado")).not.toBeInTheDocument();

    release();
    expect((await field("Nombre")).value).toBe("Agente WS2");
    expect(client.getQueryData(["agent", 1, 7])).toBeDefined();
    expect(client.getQueryData(["agent", 2, 7])).toBeDefined();
  });

  it("guardar invalida solo el detalle de este agente y la lista de este workspace", async () => {
    serve({ "GET /7": () => json(200, withDraft()), "PUT /7/draft": () => json(200, version(30, 3)) });
    const { client } = mount();
    type(await field("Rol"), "Vendedor");
    const spy = vi.spyOn(client, "invalidateQueries");
    client.setQueryData(["agents", 2], ["otro"]);
    client.setQueryData(["credits-balance", 1], { balance: 1, held: 0, available: 1 });
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(spy.mock.calls.map(([f]) => f?.queryKey)).toEqual([["agent", 1, 7], ["agents", 1]]);
    expect(client.getQueryState(["agents", 2])?.isInvalidated).toBe(false);
    expect(client.getQueryState(["credits-balance", 1])?.isInvalidated).toBe(false);
  });
});

describe("Builder + Simulation", () => {
  it("editar → guardar → simular: la simulación sigue disponible, es gratis y el Builder nunca llama a /run", async () => {
    serve({
      "GET /7": () => json(200, withDraft()),
      "PUT /7/draft": () => json(200, version(30, 3)),
      "POST /7/simulate": () => json(200, simulation({ agent: { id: 7, name: "Ventas", versionNumber: 3 } })),
    });
    mount();
    type(await field("Rol"), "Vendedor");
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(screen.getByTestId("save-result")).toHaveTextContent("no se ha publicado nada");

    expect(screen.getByTestId("simulation-mode-badge")).toHaveTextContent("SIMULATION MODE");
    type(await field("Mensaje de prueba"), "hola");
    fireEvent.click(screen.getByTestId("simulate-button"));
    expect(await screen.findByTestId("simulation-no-charge")).toHaveTextContent("0");
    expect(screen.getByTestId("simulation-result")).toHaveTextContent("v3");

    expect(calls("POST /7/simulate")).toHaveLength(1);
    expect(calls("POST /7/run")).toHaveLength(0);
    expect(calls("POST /7/publish")).toHaveLength(0);
    expect(calls("POST /7/confirm")).toHaveLength(0);
  });
});
