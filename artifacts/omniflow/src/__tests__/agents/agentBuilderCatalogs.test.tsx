import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";

const session = vi.hoisted(() => ({
  orgId: 1 as number | null,
  permissions: ["agents.read", "agents.write"] as string[],
}));
const authFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/orgContext", () => ({
  useOrg: () => ({
    org: session.orgId === null ? null : { id: session.orgId, name: `Org ${session.orgId}`, slug: "o", plan: "starter", role: "member" },
    loading: false, platformRole: "NONE", platformRoleLoading: false,
    permissions: session.permissions, hasPermission: (p: string) => session.permissions.includes(p),
  }),
}));
vi.mock("@/lib/authFetch", () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

import AgentDetailPage from "@/pages/agent-detail";
import { Toaster } from "@/components/ui/toaster";
import { agent, config, json, knowledgeCatalog, modelCatalog, simulation, toolCatalog, version } from "./fixtures";

type Handler = (init?: RequestInit) => Response | Promise<Response>;

/** Borrador con datos «antiguos»: un modelo que ya no está en el catálogo, una tool y un id de knowledge desconocidos. */
const legacyConfig = () => config({
  model: { provider: "openai", model: "gpt-3.5-legacy", fallbacks: [{ provider: "openai", model: "gpt-4o" }] },
  knowledge: { workspace: false, entryIds: [1, 999], categories: ["ventas"] },
  tools: { read: ["list_tasks", "old_tool"], write: ["create_task"] },
});
const currentConfig = () => config({
  model: { provider: "openai", model: "gpt-5.6-luna" },
  knowledge: { workspace: false, entryIds: [2], categories: [] },
  tools: { read: ["list_tasks"], write: [] },
});

const detail = (cfg = legacyConfig()) => ({
  agent: agent(7, "Ventas", { status: "draft" }),
  versions: [version(30, 1, { config: cfg })],
});

interface Cat { tools?: Handler; models?: Handler; knowledge?: Handler }
function serve(routes: Record<string, Handler>, cat: Cat = {}) {
  authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const p = String(url).replace(/^.*\/api\/agents/, "");
    const key = `${init?.method ?? "GET"} ${p}`;
    if (key === "GET /catalog/tools") return (cat.tools ?? (() => json(200, toolCatalog())))();
    if (key === "GET /catalog/models") return (cat.models ?? (() => json(200, modelCatalog())))();
    if (key === "GET /catalog/knowledge") return (cat.knowledge ?? (() => json(200, knowledgeCatalog())))();
    const h = routes[key];
    if (!h) throw new Error(`ruta no prevista en el test: ${key}`);
    return h(init);
  });
}
const keyOf = ([u, i]: unknown[]) => `${(i as RequestInit | undefined)?.method ?? "GET"} ${String(u).replace(/^.*\/api\/agents/, "")}`;
const calls = (key: string) => authFetch.mock.calls.filter((c) => keyOf(c) === key);
const putBody = () => JSON.parse((calls("PUT /7/draft")[0]![1] as RequestInit).body as string);

function mount(path = "/agents/7") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  const loc = memoryLocation({ path, record: true });
  const tree = () => (
    <QueryClientProvider client={client}>
      <Router hook={loc.hook}><Route path="/agents/:id" component={AgentDetailPage} /><Toaster /></Router>
    </QueryClientProvider>
  );
  const utils = render(tree());
  return { client, rerender: () => utils.rerender(tree()) };
}

async function openEditor() {
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Editar borrador" }), { button: 0 });
}
const modelSelect = () => screen.findByTestId("model-select") as Promise<HTMLSelectElement>;
const optionTexts = (sel: HTMLSelectElement) => [...sel.options].map((o) => o.textContent ?? "");
const detailRoute = (cfg = legacyConfig()) => ({ "GET /7": () => json(200, detail(cfg)) });

beforeEach(() => {
  authFetch.mockReset();
  session.orgId = 1;
  session.permissions = ["agents.read", "agents.write"];
});

describe("Builder + catálogos — carga", () => {
  it("los catálogos se piden al abrir el editor, no antes, y sin orgId en la URL", async () => {
    serve(detailRoute());
    mount();
    await screen.findByTestId("agent-name");
    expect(calls("GET /catalog/models")).toHaveLength(0);
    await openEditor();
    await screen.findByTestId("catalog-loading-models").catch(() => undefined);
    await waitFor(() => expect(calls("GET /catalog/models")).toHaveLength(1));
    expect(calls("GET /catalog/tools")).toHaveLength(1);
    expect(calls("GET /catalog/knowledge")).toHaveLength(1);
    for (const [url] of authFetch.mock.calls) expect(String(url)).not.toMatch(/orgId|org_id|technical/);
  });

  it("cargar los catálogos NO ensucia el formulario", async () => {
    serve(detailRoute(currentConfig()));
    mount();
    await openEditor();
    await modelSelect();
    await screen.findByTestId("knowledge-list");
    expect(screen.queryByTestId("unsaved-bar")).not.toBeInTheDocument();
    expect(screen.getByTestId("save-draft-button")).toBeDisabled();
  });

  it("estado loading mientras llegan los catálogos", async () => {
    serve(detailRoute(), { models: () => new Promise<Response>(() => undefined), knowledge: () => new Promise<Response>(() => undefined), tools: () => new Promise<Response>(() => undefined) });
    mount();
    await openEditor();
    expect(await screen.findByTestId("catalog-loading-models")).toBeInTheDocument();
    expect(screen.getByTestId("catalog-loading-knowledge")).toBeInTheDocument();
    expect(screen.getByTestId("catalog-loading-tools")).toBeInTheDocument();
    expect(screen.getByTestId("model-select")).toBeDisabled();
  });
});

describe("Selector de modelo", () => {
  it("ofrece SOLO los modelos del catálogo (más «predeterminado» y, si lo hay, el valor ya guardado)", async () => {
    serve(detailRoute(currentConfig()));
    mount();
    await openEditor();
    const sel = await modelSelect();
    await waitFor(() => expect(sel.options.length).toBe(3));
    expect(optionTexts(sel)).toEqual([
      "Predeterminado del sistema (sin modelo fijo)",
      "openai / gpt-5.6-luna",
      "openai / gpt-4o-mini · precio provisional",
    ]);
    expect(sel.value).toBe("openai/gpt-5.6-luna");
    expect(screen.getByTestId("model-selector").textContent).not.toMatch(/claude|gemini/i);
  });

  it("los modelos provisionales se marcan y no aparece ningún precio técnico", async () => {
    serve(detailRoute(currentConfig()));
    mount();
    await openEditor();
    const box = await screen.findByTestId("model-selector");
    await waitFor(() => expect(within(box).getAllByRole("option").length).toBe(3));
    expect(box).toHaveTextContent("precio provisional");
    expect(box.textContent).not.toMatch(/\$|USD|€|Per1M|inputCost|outputCost|https?:\/\//);
    expect(screen.getByTestId("model-select").outerHTML).not.toContain("docs.example");
  });

  it("no hay campo de provider: se deriva del modelo elegido", async () => {
    serve(detailRoute(currentConfig()));
    mount();
    await openEditor();
    const sel = await modelSelect();
    await waitFor(() => expect(sel.options.length).toBe(3));
    expect(screen.queryByLabelText(/provider|proveedor/i)).toBeNull();
    expect(screen.getByTestId("model-provider")).toHaveTextContent("Proveedor: openai");
    fireEvent.change(sel, { target: { value: "openai/gpt-4o-mini" } });
    expect(screen.getByTestId("model-provider")).toHaveTextContent("Proveedor: openai");
  });

  it("elegir un modelo ensucia el formulario y se guarda como model = {provider, model} (conserva fallbacks)", async () => {
    serve({ ...detailRoute(), "PUT /7/draft": () => json(200, version(30, 1)) });
    mount();
    await openEditor();
    const sel = await modelSelect();
    await waitFor(() => expect(sel.options.length).toBe(4));       // predeterminado + guardado (legacy) + 2 del catálogo
    fireEvent.change(sel, { target: { value: "openai/gpt-5.6-luna" } });
    expect(screen.getByTestId("unsaved-bar")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(putBody()).toEqual({ config: { model: { provider: "openai", model: "gpt-5.6-luna", fallbacks: [{ provider: "openai", model: "gpt-4o" }] } } });
  });

  it("un modelo que no está en el catálogo no se puede elegir: no existe como opción", async () => {
    serve(detailRoute(currentConfig()));
    mount();
    await openEditor();
    const sel = await modelSelect();
    await waitFor(() => expect(sel.options.length).toBe(3));
    const values = [...sel.options].map((o) => o.value);
    expect(values).not.toContain("claude/anything");
    expect(values).not.toContain("openai/gpt-9");
    expect(values.every((v) => v === "" || ["openai/gpt-5.6-luna", "openai/gpt-4o-mini"].includes(v))).toBe(true);
  });

  it("MODELO LEGACY: se conserva, se avisa y no se borra al abrir ni al guardar otra cosa", async () => {
    serve({ ...detailRoute(), "PUT /7/draft": () => json(200, version(30, 1)) });
    mount();
    await openEditor();
    const sel = await modelSelect();
    await waitFor(() => expect(screen.getByTestId("model-legacy-notice")).toBeInTheDocument());
    expect(screen.getByTestId("model-legacy-notice")).toHaveTextContent("Configuración existente no disponible en el catálogo");
    expect(sel.value).toBe("legacy:openai/gpt-3.5-legacy");
    expect(optionTexts(sel).some((t) => t.includes("gpt-3.5-legacy") && t.includes("Configuración existente no disponible en el catálogo"))).toBe(true);
    expect(screen.queryByTestId("unsaved-bar")).not.toBeInTheDocument();
    // guardar un cambio ajeno no toca el modelo
    fireEvent.change(screen.getByLabelText("Rol"), { target: { value: "Otro rol" } });
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(Object.keys(putBody().config)).toEqual(["identity"]);
  });

  it("del legacy se puede pasar a un modelo del catálogo y volver atrás con «Cancelar»", async () => {
    serve(detailRoute());
    mount();
    await openEditor();
    const sel = await modelSelect();
    await waitFor(() => expect(sel.options.length).toBe(4));
    fireEvent.change(sel, { target: { value: "openai/gpt-4o-mini" } });
    expect(screen.queryByTestId("model-legacy-notice")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("cancel-button"));
    expect((await modelSelect()).value).toBe("legacy:openai/gpt-3.5-legacy");
  });

  it("estado vacío: sin modelos disponibles se explica y el selector queda desactivado", async () => {
    serve(detailRoute(config({ model: {} })), { models: () => json(200, { providers: [{ id: "openai", available: false }], models: [] }) });
    mount();
    await openEditor();
    expect(await screen.findByTestId("model-empty")).toHaveTextContent("No hay modelos disponibles en este entorno.");
    expect(screen.getByTestId("model-empty")).toHaveTextContent("openai no está disponible");
    expect(screen.getByTestId("model-select")).toBeDisabled();
  });

  it.each([
    [401, "auth"], [403, "permission"], [404, "not_found"], [409, "conflict"], [422, "validation"], [429, "429"], [500, "server"],
  ])("error HTTP %i: mensaje recuperable con su código; «Reintentar» vuelve a pedir el catálogo y el valor guardado no se pierde", async (status) => {
    let attempts = 0;
    serve(detailRoute(currentConfig()), { models: () => (++attempts === 1 ? json(status, { error: "x" }) : json(200, modelCatalog())) });
    mount();
    await openEditor();
    expect(await screen.findByTestId("catalog-error-models")).toBeInTheDocument();
    expect(screen.getByTestId("catalog-error-technical-models")).toHaveTextContent(`HTTP ${status}`);
    expect(screen.getByTestId("model-select")).toBeDisabled();
    expect(screen.queryByTestId("unsaved-bar")).not.toBeInTheDocument();
    fireEvent.click(within(screen.getByTestId("catalog-error-models")).getByRole("button", { name: "Reintentar" }));
    await waitFor(() => expect(screen.queryByTestId("catalog-error-models")).not.toBeInTheDocument());
    expect((await modelSelect()).value).toBe("openai/gpt-5.6-luna");
    expect(attempts).toBe(2);
  });
});

describe("Selector de knowledge", () => {
  it("muestra título y categoría, nunca el contenido (aunque el servidor lo enviara)", async () => {
    serve(detailRoute(currentConfig()), { knowledge: () => json(200, [{ id: 1, title: "Horarios", category: "general", content: "TEXTO-CONFIDENCIAL" }, { id: 2, title: "Tarifas", category: "ventas" }]) });
    mount();
    await openEditor();
    const list = await screen.findByTestId("knowledge-list");
    expect(within(list).getByText("Horarios")).toBeInTheDocument();
    expect(within(list).getByText("general")).toBeInTheDocument();
    expect(within(list).getByText("ventas")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("TEXTO-CONFIDENCIAL");
  });

  it("los ids seleccionados salen marcados y marcar/desmarcar actualiza config.knowledge.entryIds", async () => {
    serve({ ...detailRoute(currentConfig()), "PUT /7/draft": () => json(200, version(30, 1)) });
    mount();
    await openEditor();
    await screen.findByTestId("knowledge-list");
    expect(screen.getByLabelText(/Tarifas 2026/)).toHaveAttribute("data-state", "checked");
    expect(screen.getByLabelText(/Horarios de apertura/)).toHaveAttribute("data-state", "unchecked");
    fireEvent.click(screen.getByLabelText(/Horarios de apertura/));
    expect(screen.getByTestId("unsaved-bar")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(putBody()).toEqual({ config: { knowledge: { workspace: false, entryIds: [2, 1], categories: [] } } });
  });

  it("desmarcar todo envía entryIds vacío, conservando workspace y categories", async () => {
    serve({ ...detailRoute(config({ knowledge: { workspace: false, entryIds: [2], categories: ["ventas"] } })), "PUT /7/draft": () => json(200, version(30, 1)) });
    mount();
    await openEditor();
    await screen.findByTestId("knowledge-list");
    fireEvent.click(screen.getByLabelText(/Tarifas 2026/));
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(putBody()).toEqual({ config: { knowledge: { workspace: false, entryIds: [], categories: ["ventas"] } } });
  });

  it("KNOWLEDGE LEGACY: un id que el catálogo no devuelve se conserva y se marca; solo desaparece si el usuario lo desmarca", async () => {
    serve({ ...detailRoute(), "PUT /7/draft": () => json(200, version(30, 1)) });
    mount();
    await openEditor();
    const legacy = await screen.findByTestId("knowledge-legacy-999");
    expect(legacy).toHaveTextContent("Entrada #999");
    expect(legacy).toHaveTextContent("Configuración existente no disponible en el catálogo");
    expect(screen.getByLabelText(/Entrada #999/)).toHaveAttribute("data-state", "checked");
    expect(screen.queryByTestId("unsaved-bar")).not.toBeInTheDocument();
    // tocar otro elemento conserva el 999
    fireEvent.click(screen.getByLabelText(/Tarifas 2026/));
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(putBody().config.knowledge.entryIds.sort()).toEqual([1, 2, 999]);
  });

  it("desmarcar explícitamente el legacy lo elimina", async () => {
    serve({ ...detailRoute(), "PUT /7/draft": () => json(200, version(30, 1)) });
    mount();
    await openEditor();
    await screen.findByTestId("knowledge-legacy-999");
    fireEvent.click(screen.getByLabelText(/Entrada #999/));
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(putBody().config.knowledge.entryIds).toEqual([1]);
  });

  it("estado vacío y aviso cuando el agente usa todo el conocimiento del workspace", async () => {
    serve(detailRoute(config({ knowledge: { workspace: true, entryIds: [], categories: [] } })), { knowledge: () => json(200, []) });
    mount();
    await openEditor();
    expect(await screen.findByTestId("knowledge-empty")).toHaveTextContent("no tiene entradas de conocimiento activas");
    expect(screen.getByTestId("knowledge-workspace-note")).toBeInTheDocument();
  });

  it("error del catálogo de knowledge: mensaje recuperable y el resto del editor sigue usable", async () => {
    serve(detailRoute(currentConfig()), { knowledge: () => json(403, { error: "permission_denied", message: "No tienes permiso" }) });
    mount();
    await openEditor();
    expect(await screen.findByTestId("catalog-error-knowledge")).toBeInTheDocument();
    expect(screen.getByTestId("catalog-error-technical-knowledge")).toHaveTextContent("HTTP 403");
    fireEvent.change(screen.getByLabelText("Rol"), { target: { value: "otro" } });
    expect(screen.getByTestId("unsaved-bar")).toBeInTheDocument();
  });
});

describe("Herramientas (solo lectura)", () => {
  it("describe cada tool declarada con el catálogo: nombre, descripción, tipo, permiso y módulo", async () => {
    serve(detailRoute(currentConfig()));
    mount();
    await openEditor();
    expect(await screen.findByTestId("tool-name-list_tasks")).toHaveTextContent("Listar tareas");
    const row = screen.getByTestId("tool-list_tasks");
    expect(row).toHaveTextContent("Devuelve las tareas pendientes.");
    expect(screen.getByTestId("tool-kind-list_tasks")).toHaveTextContent("Lectura");
    expect(screen.getByTestId("tool-meta-list_tasks")).toHaveTextContent("crm.read");
    expect(screen.getByTestId("tool-meta-list_tasks")).toHaveTextContent("crm");
    expect(screen.getByTestId("tool-params-list_tasks")).toHaveTextContent("status");
  });

  it("marca las acciones y los parámetros obligatorios", async () => {
    serve(detailRoute());
    mount();
    await openEditor();
    expect(await screen.findByTestId("tool-kind-create_task")).toHaveTextContent("Acción");
    expect(screen.getByTestId("tool-params-create_task")).toHaveTextContent("obligatorio");
  });

  it("no permite editar nada: sin inputs, selects, checkboxes ni botones dentro del panel", async () => {
    serve(detailRoute());
    mount();
    await openEditor();
    const panel = await screen.findByTestId("tools-panel");
    await screen.findByTestId("tool-name-list_tasks");
    expect(within(panel).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(panel).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(panel).queryAllByRole("checkbox")).toHaveLength(0);
    expect(within(panel).queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByTestId("tools-readonly-note")).toHaveTextContent("Solo lectura");
    expect(screen.queryByText(/añadir herramienta|crear herramienta|nueva herramienta/i)).toBeNull();
    // ni permisos de confirmación editables
    expect(screen.queryByLabelText(/confirmación/i)).toBeNull();
  });

  it("TOOL LEGACY: una tool declarada que el catálogo no tiene se conserva y se marca", async () => {
    serve(detailRoute());
    mount();
    await openEditor();
    const legacy = await screen.findByTestId("tool-legacy-old_tool");
    expect(legacy).toHaveTextContent("Configuración existente no disponible en el catálogo");
    expect(screen.getByTestId("tool-name-list_tasks")).toBeInTheDocument();
  });

  it("una tool declarada en el grupo equivocado se avisa (el backend no la usará)", async () => {
    serve(detailRoute(config({ tools: { read: ["create_task"], write: [] } })));
    mount();
    await openEditor();
    expect(await screen.findByTestId("tool-mismatch-create_task")).toHaveTextContent("Declarada como lectura, pero es de tipo acción");
  });

  it("las tools nunca forman parte de lo que se guarda", async () => {
    serve({ ...detailRoute(), "PUT /7/draft": () => json(200, version(30, 1)) });
    mount();
    await openEditor();
    await screen.findByTestId("tool-name-list_tasks");
    fireEvent.change(screen.getByLabelText("Rol"), { target: { value: "X" } });
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(JSON.stringify(putBody())).not.toMatch(/"tools"|"permissions"/);
  });

  it("error del catálogo de tools: aviso recuperable", async () => {
    serve(detailRoute(), { tools: () => json(500, { error: "boom" }) });
    mount();
    await openEditor();
    expect(await screen.findByTestId("catalog-error-tools")).toBeInTheDocument();
    expect(screen.getByTestId("catalog-error-technical-tools")).toHaveTextContent("HTTP 500");
  });
});

describe("Catálogos — caché y workspace", () => {
  it("guardar no invalida ni vuelve a pedir los catálogos", async () => {
    serve({ ...detailRoute(currentConfig()), "PUT /7/draft": () => json(200, version(30, 1)) });
    const { client } = mount();
    await openEditor();
    await screen.findByTestId("knowledge-list");
    await screen.findByTestId("tool-name-list_tasks");
    const spy = vi.spyOn(client, "invalidateQueries");
    fireEvent.change(screen.getByLabelText("Rol"), { target: { value: "X" } });
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    const keys = spy.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
    expect(keys.join()).not.toMatch(/catalog/);
    expect(calls("GET /catalog/models")).toHaveLength(1);
    expect(calls("GET /catalog/tools")).toHaveLength(1);
    expect(calls("GET /catalog/knowledge")).toHaveLength(1);
  });

  it("simular tampoco toca los catálogos", async () => {
    serve({ ...detailRoute(currentConfig()), "POST /7/simulate": () => json(200, simulation()) });
    const { client } = mount();
    await openEditor();
    await screen.findByTestId("knowledge-list");
    const spy = vi.spyOn(client, "invalidateQueries");
    fireEvent.change(screen.getByLabelText("Mensaje de prueba"), { target: { value: "hola" } });
    fireEvent.click(screen.getByTestId("simulate-button"));
    await screen.findByTestId("simulation-result");
    expect(spy.mock.calls.map(([f]) => JSON.stringify(f?.queryKey)).join()).not.toMatch(/catalog/);
    expect(calls("GET /catalog/models")).toHaveLength(1);
  });

  it("cada workspace tiene su propia clave de catálogo y no se mezclan los datos", async () => {
    serve(detailRoute(currentConfig()), {
      knowledge: () => json(200, session.orgId === 1 ? [{ id: 1, title: "Del workspace UNO", category: "a" }] : [{ id: 5, title: "Del workspace DOS", category: "b" }]),
    });
    const { client, rerender } = mount();
    await openEditor();
    expect(await screen.findByText("Del workspace UNO")).toBeInTheDocument();

    session.orgId = 2;
    rerender();
    expect(screen.queryByText("Del workspace UNO")).not.toBeInTheDocument();
    await waitFor(() => expect(client.getQueryData(["agent-catalog-knowledge", 1])).toBeDefined());
    expect(client.getQueryData(["agent-catalog-knowledge", 2])).toBeUndefined();     // el editor se cierra al cambiar de workspace
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Editar borrador" }), { button: 0 });
    expect(await screen.findByText("Del workspace DOS")).toBeInTheDocument();
    expect(screen.queryByText("Del workspace UNO")).not.toBeInTheDocument();
    expect(client.getQueryData(["agent-catalog-knowledge", 2])).toEqual([{ id: 5, title: "Del workspace DOS", category: "b" }]);
  });

  it("lectores sin agents.write no ven el editor y por tanto no piden catálogos", async () => {
    session.permissions = ["agents.read"];
    serve(detailRoute(currentConfig()));
    mount();
    await screen.findByTestId("agent-name");
    expect(calls("GET /catalog/models")).toHaveLength(0);
    expect(calls("GET /catalog/tools")).toHaveLength(0);
  });
});
