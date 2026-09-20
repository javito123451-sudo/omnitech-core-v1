import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactNode } from "react";

const session = vi.hoisted(() => ({
  orgId: 1 as number | null,
  permissions: ["agents.read", "agents.publish"] as string[],
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
import { EffectiveToolAccessPanel } from "@/components/agents/EffectiveToolAccessPanel";
import { useAgentEffectiveAccess, useAgentToolCatalog } from "@/lib/agents/hooks";
import { Toaster } from "@/components/ui/toaster";
import { agent, config, effectiveAccess, json, knowledgeCatalog, modelCatalog, toolCatalog, version } from "./fixtures";
import type { EffectiveToolAccessItem } from "@/lib/agents/types";

type Handler = (init?: RequestInit) => Response | Promise<Response>;

const goodConfig = () => config({
  model: { provider: "openai", model: "gpt-5.6-luna", fallbacks: [{ provider: "openai", model: "gpt-4o-mini" }] },
  knowledge: { workspace: false, entryIds: [1, 2], categories: [] },
  tools: { read: ["list_tasks"], write: ["create_task"] },
});
const legacyConfig = () => config({
  model: { provider: "openai", model: "gpt-3.5-legacy" },
  knowledge: { workspace: false, entryIds: [1, 999], categories: [] },
  tools: { read: ["list_tasks", "old_tool"], write: ["create_task"] },
});

const item = (over: Partial<EffectiveToolAccessItem> & { toolId: string }): EffectiveToolAccessItem => ({
  declaredAs: "read", kind: "read", permission: "crm.read", module: "crm", allowed: true, reason: "allowed", requiresConfirmation: false, message: "Disponible.", ...over,
});
const access = (tools: EffectiveToolAccessItem[]) => effectiveAccess({
  tools, summary: { declared: tools.length, allowed: tools.filter((t) => t.allowed).length, denied: tools.filter((t) => !t.allowed).length, requireConfirmation: tools.filter((t) => t.requiresConfirmation).length },
});
const goodAccess = () => access([
  item({ toolId: "list_tasks" }),
  item({ toolId: "create_task", declaredAs: "write", kind: "action", permission: "crm.write", reason: "confirmation_required", requiresConfirmation: true, message: "Disponible: cada acción necesita la confirmación de una persona." }),
]);

const detail = (cfg = goodConfig(), agentOver: Record<string, unknown> = {}) => ({
  agent: agent(7, "Ventas", { status: "published", activeVersionId: 20, monthlyCreditLimit: 5000, ...agentOver }),
  versions: [version(30, 3, { config: cfg }), version(20, 2, { publishedAt: "2026-05-02T09:00:00Z" })],
});

interface Over { tools?: Handler; models?: Handler; knowledge?: Handler; access?: Handler; publish?: Handler; detail?: Handler }
function serve(over: Over = {}) {
  authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace(/^.*\/api\/agents/, "")}`;
    if (key === "GET /catalog/tools") return (over.tools ?? (() => json(200, toolCatalog())))();
    if (key === "GET /catalog/models") return (over.models ?? (() => json(200, modelCatalog())))();
    if (key === "GET /catalog/knowledge") return (over.knowledge ?? (() => json(200, knowledgeCatalog())))();
    if (key === "GET /7/effective-access") return (over.access ?? (() => json(200, goodAccess())))();
    if (key === "GET /7") return (over.detail ?? (() => json(200, detail())))();
    if (key === "POST /7/publish") return (over.publish ?? (() => json(200, { agent: agent(7, "Ventas"), publishedVersionNumber: 3 })))();
    throw new Error(`ruta no prevista en el test: ${key}`);
  });
}
const keyOf = ([u, i]: unknown[]) => `${(i as RequestInit | undefined)?.method ?? "GET"} ${String(u).replace(/^.*\/api\/agents/, "")}`;
const calls = (key: string) => authFetch.mock.calls.filter((c) => keyOf(c) === key);

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  const loc = memoryLocation({ path: "/agents/7", record: true });
  const tree = () => (
    <QueryClientProvider client={client}>
      <Router hook={loc.hook}><Route path="/agents/:id" component={AgentDetailPage} /><Toaster /></Router>
    </QueryClientProvider>
  );
  const utils = render(tree());
  return { client, rerender: () => utils.rerender(tree()) };
}

async function openPublish() {
  fireEvent.click(await screen.findByTestId("publish-agent-button"));
  return screen.findByTestId("publish-review");
}
const confirmBtn = () => screen.getByTestId("publish-confirm-button") as HTMLButtonElement;
const tick = () => fireEvent.click(screen.getByRole("checkbox"));

beforeEach(() => {
  authFetch.mockReset();
  session.orgId = 1;
  session.permissions = ["agents.read", "agents.publish"];
});

describe("Revisión antes de publicar", () => {
  it("muestra identidad, objetivo, personalidad, comportamiento, contexto, modelo, respaldos, conocimiento, herramientas, presupuesto, versión y estado", async () => {
    serve();
    mount();
    const review = await openPublish();
    await waitFor(() => expect(within(review).getByTestId("access-row-list_tasks")).toBeInTheDocument());
    expect(within(review).getByTestId("review-identity")).toHaveTextContent("Asistente comercial");
    expect(within(review).getByTestId("review-objective")).toHaveTextContent("Atender consultas de clientes");
    expect(within(review).getByTestId("review-personality")).toHaveTextContent("cercano");
    expect(within(review).getByTestId("review-behavior")).toHaveTextContent("Responde con amabilidad.");
    expect(within(review).getByTestId("review-context")).toHaveTextContent("Taller mecánico en Valencia");
    expect(within(review).getByTestId("review-model")).toHaveTextContent("openai / gpt-5.6-luna");
    expect(within(review).getByTestId("review-fallbacks")).toHaveTextContent("openai / gpt-4o-mini");
    expect(within(review).getByTestId("review-knowledge")).toHaveTextContent("Horarios de apertura, Tarifas 2026");
    expect(within(review).getByTestId("review-tools")).toHaveTextContent("Listar tareas (lectura)");
    expect(within(review).getByTestId("review-tools")).toHaveTextContent("Crear tarea (acción)");
    expect(within(review).getByTestId("review-budgets")).toHaveTextContent("5.000 al mes");
    expect(within(review).getByTestId("review-version")).toHaveTextContent("v3");
    expect(within(review).getByTestId("review-status")).toHaveTextContent("Publicado");
  });

  it("no muestra claves, precios internos ni contenido de documentos", async () => {
    serve({ knowledge: () => json(200, [{ id: 1, title: "Horarios", category: "g", content: "TEXTO-CONFIDENCIAL" }, { id: 2, title: "Tarifas", category: "v" }]) });
    mount();
    const review = await openPublish();
    await waitFor(() => expect(within(review).getByTestId("access-row-list_tasks")).toBeInTheDocument());
    expect(document.body.textContent).not.toMatch(/TEXTO-CONFIDENCIAL|API_KEY|sk-|Per1M|inputCost|outputCost|USD|\$\d/);
  });

  it("incluye el acceso efectivo: herramienta, tipo, permiso, módulo, estado y motivo", async () => {
    serve();
    mount();
    const review = await openPublish();
    const row = await within(review).findByTestId("access-row-create_task");
    expect(row).toHaveAttribute("data-allowed", "true");
    expect(within(row).getByTestId("access-kind-create_task")).toHaveTextContent("ACTION");
    expect(row).toHaveTextContent("crm.write");
    expect(row).toHaveTextContent("crm");
    expect(within(row).getByTestId("access-state-create_task")).toHaveTextContent("Disponible con confirmación");
    expect(row).toHaveTextContent("confirmación de una persona");
    expect(within(review).getByTestId("access-kind-list_tasks")).toHaveTextContent("READ");
  });
});

describe("Publicar: bloqueo y confirmación", () => {
  it("con todo válido: hay que marcar la confirmación y entonces publica (agents.publish)", async () => {
    serve();
    mount();
    await openPublish();
    await waitFor(() => expect(screen.queryByTestId("publish-verifying")).not.toBeInTheDocument());
    expect(screen.queryByTestId("publish-blockers")).not.toBeInTheDocument();
    expect(confirmBtn()).toBeDisabled();                                  // sin confirmar
    fireEvent.click(confirmBtn());
    expect(calls("POST /7/publish")).toHaveLength(0);
    tick();
    expect(confirmBtn()).toBeEnabled();
    fireEvent.click(confirmBtn());
    expect(await screen.findByText("Agente publicado")).toBeInTheDocument();
    expect(calls("POST /7/publish")).toHaveLength(1);
  });

  it("configuración legacy (modelo, tool y conocimiento): se avisa, no se borra nada y publicar queda bloqueado aunque se confirme", async () => {
    serve({ detail: () => json(200, detail(legacyConfig())) });
    mount();
    await openPublish();
    const blockers = await screen.findByTestId("publish-blockers");
    expect(blockers).toHaveTextContent("Configuración existente no disponible actualmente");
    expect(within(blockers).getByTestId("blocker-model")).toHaveTextContent("gpt-3.5-legacy");
    expect(within(blockers).getByTestId("blocker-knowledge-999")).toBeInTheDocument();
    expect(within(blockers).getByTestId("blocker-tool-old_tool")).toBeInTheDocument();
    tick();
    expect(confirmBtn()).toBeDisabled();
    fireEvent.click(confirmBtn());
    expect(calls("POST /7/publish")).toHaveLength(0);
    // el diálogo solo lee: nunca escribe el borrador
    expect(authFetch.mock.calls.filter((c) => ["PUT", "PATCH"].includes((c[1] as RequestInit | undefined)?.method ?? ""))).toHaveLength(0);
  });

  it.each([
    ["modelo inexistente", () => config({ model: { provider: "openai", model: "fantasma" } })],
    ["fallback inexistente", () => config({ model: { provider: "openai", model: "gpt-5.6-luna", fallbacks: [{ provider: "openai", model: "fantasma" }] } })],
    ["provider stub", () => config({ model: { provider: "claude" } })],
    ["knowledge inexistente", () => config({ knowledge: { workspace: false, entryIds: [12345], categories: [] } })],
    ["tool inexistente", () => config({ tools: { read: ["old_tool"], write: [] } })],
    ["acción sin confirmación", () => config({ permissions: { writesRequireConfirmation: false } })],
  ])("%s → bloqueado", async (_n, cfg) => {
    serve({ detail: () => json(200, detail(cfg())) });
    mount();
    await openPublish();
    await screen.findByTestId("publish-blockers");
    tick();
    expect(confirmBtn()).toBeDisabled();
  });

  it("que tu rol no pueda usar una herramienta NO bloquea: solo se informa", async () => {
    serve({ access: () => json(200, access([
      item({ toolId: "list_tasks" }),
      item({ toolId: "create_task", declaredAs: "write", kind: "action", permission: "crm.write", allowed: false, reason: "missing_permission", message: "El rol 'member' no tiene el permiso 'crm.write'." }),
    ])) });
    mount();
    await openPublish();
    const row = await screen.findByTestId("access-row-create_task");
    expect(row).toHaveAttribute("data-allowed", "false");
    expect(within(row).getByTestId("access-state-create_task")).toHaveTextContent("Sin permiso");
    expect(screen.getByTestId("review-denied-note")).toHaveTextContent("create_task");
    expect(screen.queryByTestId("publish-blockers")).not.toBeInTheDocument();
    tick();
    expect(confirmBtn()).toBeEnabled();
  });

  it("si no se puede verificar (acceso efectivo con error) NO se puede confirmar; se puede reintentar y el borrador sigue intacto", async () => {
    let n = 0;
    serve({ access: () => (++n === 1 ? json(500, { error: "boom" }) : json(200, goodAccess())) });
    mount();
    await openPublish();
    expect(await screen.findByTestId("publish-verify-failed")).toBeInTheDocument();
    tick();
    expect(confirmBtn()).toBeDisabled();
    fireEvent.click(screen.getByTestId("publish-verify-retry"));
    await waitFor(() => expect(screen.queryByTestId("publish-verify-failed")).not.toBeInTheDocument());
    await waitFor(() => expect(confirmBtn()).toBeEnabled());
  });

  it("si falla un catálogo tampoco se puede confirmar", async () => {
    serve({ models: () => json(503, { error: "down" }) });
    mount();
    await openPublish();
    expect(await screen.findByTestId("publish-verify-failed")).toBeInTheDocument();
    tick();
    expect(confirmBtn()).toBeDisabled();
  });

  it("mientras verifica no se puede confirmar", async () => {
    serve({ access: () => new Promise<Response>(() => undefined) });
    mount();
    await openPublish();
    expect(await screen.findByTestId("publish-verifying")).toBeInTheDocument();
    tick();
    expect(confirmBtn()).toBeDisabled();
  });

  it("el 422 del backend (validación autoritativa) se muestra con sus problemas y el diálogo sigue abierto", async () => {
    serve({ publish: () => json(422, { error: "El agente no está listo para publicarse.", problems: ["El modelo «gpt-5.6-luna» no está disponible para el proveedor «openai»."], problemDetails: [{ field: "config.model.model", code: "UNKNOWN_MODEL", message: "El modelo «gpt-5.6-luna» no está disponible para el proveedor «openai»." }] }) });
    mount();
    await openPublish();
    await waitFor(() => expect(screen.queryByTestId("publish-verifying")).not.toBeInTheDocument());
    tick();
    fireEvent.click(confirmBtn());
    expect(await screen.findByTestId("error-problems")).toHaveTextContent("no está disponible para el proveedor");
    expect(screen.getByTestId("error-technical")).toHaveTextContent("HTTP 422");
    expect(screen.getByTestId("publish-confirm-button")).toBeInTheDocument();
  });

  it("no se publica automáticamente ni al abrir el diálogo ni al cargar la revisión", async () => {
    serve();
    mount();
    await openPublish();
    await waitFor(() => expect(screen.queryByTestId("publish-verifying")).not.toBeInTheDocument());
    expect(calls("POST /7/publish")).toHaveLength(0);
  });

  it("solo con agents.publish: agents.read y agents.write no ven «Publicar» ni piden el acceso efectivo del diálogo", async () => {
    session.permissions = ["agents.read", "agents.write"];
    serve();
    mount();
    await screen.findByTestId("agent-name");
    expect(screen.queryByTestId("publish-agent-button")).not.toBeInTheDocument();
    expect(calls("GET /7/effective-access")).toHaveLength(0);
  });

  it("abrir la revisión no consume créditos ni ejecuta nada: solo lecturas GET", async () => {
    serve();
    mount();
    await openPublish();
    await waitFor(() => expect(screen.queryByTestId("publish-verifying")).not.toBeInTheDocument());
    const methods = authFetch.mock.calls.map((c) => (c[1] as RequestInit | undefined)?.method ?? "GET");
    expect(methods.every((m) => m === "GET")).toBe(true);
    expect(authFetch.mock.calls.map((c) => String(c[0])).join(" ")).not.toMatch(/\/credits|\/run|\/simulate|\/confirm/);
  });
});

describe("Acceso efectivo en el editor", () => {
  it("se pide al abrir el editor, no ensucia el formulario y no toca créditos", async () => {
    session.permissions = ["agents.read", "agents.write"];
    serve();
    mount();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Editar borrador" }), { button: 0 });
    const panel = await screen.findByTestId("effective-access");
    await waitFor(() => expect(within(panel).getByTestId("access-row-create_task")).toBeInTheDocument());
    expect(screen.queryByTestId("unsaved-bar")).not.toBeInTheDocument();
    expect(screen.getByTestId("save-draft-button")).toBeDisabled();
    expect(calls("GET /7/effective-access")).toHaveLength(1);
    expect(authFetch.mock.calls.map((c) => String(c[0])).join(" ")).not.toMatch(/\/credits/);
  });

  it("guardar otros campos no vuelve a calcular el acceso efectivo (la clave depende de las herramientas)", async () => {
    session.permissions = ["agents.read", "agents.write"];
    authFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      const key = keyOf([url, init]);
      if (key === "PUT /7/draft") return json(200, version(30, 3));
      if (key === "GET /catalog/tools") return json(200, toolCatalog());
      if (key === "GET /catalog/models") return json(200, modelCatalog());
      if (key === "GET /catalog/knowledge") return json(200, knowledgeCatalog());
      if (key === "GET /7/effective-access") return json(200, goodAccess());
      if (key === "GET /7") return json(200, detail());
      throw new Error(key);
    });
    mount();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Editar borrador" }), { button: 0 });
    await screen.findByTestId("access-row-list_tasks");
    fireEvent.change(screen.getByLabelText("Rol"), { target: { value: "otro" } });
    fireEvent.click(screen.getByTestId("save-draft-button"));
    await screen.findByTestId("save-result");
    expect(calls("GET /7/effective-access")).toHaveLength(1);
  });

  it("la clave incluye el workspace y no se reutiliza el cálculo de otro", async () => {
    session.permissions = ["agents.read", "agents.write"];
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    serve({ access: async () => { if (session.orgId === 2) await gate; return json(200, session.orgId === 1 ? goodAccess() : access([item({ toolId: "list_tasks", reason: "missing_permission", allowed: false, message: "Del workspace DOS" })])); } });
    const { client, rerender } = mount();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Editar borrador" }), { button: 0 });
    await screen.findByTestId("access-row-create_task");
    const target = `30:${JSON.stringify(goodConfig().tools)}`;
    expect(client.getQueryData(["agent-effective-access", 1, 7, target])).toBeDefined();

    session.orgId = 2;
    rerender();
    expect(screen.queryByTestId("access-row-create_task")).not.toBeInTheDocument();
    release();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Editar borrador" }), { button: 0 });
    expect(await screen.findByText("Del workspace DOS")).toBeInTheDocument();
    expect(client.getQueryData(["agent-effective-access", 2, 7, target])).toBeDefined();
    expect(client.getQueryData(["agent-effective-access", 1, 7, target])).toBeDefined();
  });
});

describe("EffectiveToolAccessPanel", () => {
  function Panel() {
    const a = useAgentEffectiveAccess(7, "t");
    const c = useAgentToolCatalog();
    return <EffectiveToolAccessPanel access={a} catalog={c} />;
  }
  const wrap = () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
  const mountPanel = () => { const W = wrap(); return render(<W><Panel /></W>); };
  const serveAccess = (h: Handler) => authFetch.mockImplementation(async (url: string) => {
    const p = String(url).replace(/^.*\/api\/agents/, "");
    if (p === "/catalog/tools") return json(200, toolCatalog());
    if (p === "/7/effective-access") return h();
    throw new Error(p);
  });

  it("loading", async () => {
    serveAccess(() => new Promise<Response>(() => undefined));
    mountPanel();
    expect(await screen.findByTestId("catalog-loading-access")).toBeInTheDocument();
  });

  it("error recuperable con código técnico y «Reintentar»", async () => {
    let n = 0;
    serveAccess(() => (++n === 1 ? json(403, { error: "permission_denied", message: "sin permiso" }) : json(200, goodAccess())));
    mountPanel();
    expect(await screen.findByTestId("catalog-error-technical-access")).toHaveTextContent("HTTP 403");
    fireEvent.click(within(screen.getByTestId("catalog-error-access")).getByRole("button", { name: "Reintentar" }));
    expect(await screen.findByTestId("access-row-list_tasks")).toBeInTheDocument();
  });

  it("empty: sin herramientas declaradas", async () => {
    serveAccess(() => json(200, access([])));
    mountPanel();
    expect(await screen.findByTestId("access-empty")).toHaveTextContent("no declara herramientas");
  });

  it("ready: disponible y denegado con su motivo; ejemplo «delete_client» sin permiso; usa el nombre del catálogo", async () => {
    serveAccess(() => json(200, access([
      item({ toolId: "create_task", declaredAs: "write", kind: "action", permission: "crm.write", reason: "confirmation_required", requiresConfirmation: true, message: "Disponible: cada acción necesita la confirmación de una persona." }),
      item({ toolId: "delete_client", declaredAs: "write", kind: "action", permission: "crm.delete", allowed: false, reason: "missing_permission", message: "El rol 'member' no tiene el permiso 'crm.delete'." }),
      item({ toolId: "get_invoice", permission: "accounting.read", module: "omni_accounting", allowed: false, reason: "module_disabled", message: "El módulo 'omni_accounting' no está habilitado en este workspace." }),
      item({ toolId: "fantasma", kind: null, permission: null, module: null, allowed: false, reason: "unknown_tool", message: "Herramienta desconocida." }),
    ])));
    mountPanel();
    const ok = await screen.findByTestId("access-row-create_task");
    expect(ok).toHaveAttribute("data-allowed", "true");
    expect(ok).toHaveTextContent("Crear tarea");                                     // nombre del catálogo
    expect(screen.getByTestId("access-state-delete_client")).toHaveTextContent("Sin permiso");
    expect(screen.getByTestId("access-row-delete_client")).toHaveTextContent("crm.delete");
    expect(screen.getByTestId("access-row-delete_client")).toHaveAttribute("data-reason", "missing_permission");
    expect(screen.getByTestId("access-state-get_invoice")).toHaveTextContent("Módulo desactivado");
    expect(screen.getByTestId("access-state-fantasma")).toHaveTextContent("Herramienta desconocida");
    expect(screen.getByTestId("access-kind-fantasma")).toHaveTextContent("—");
    expect(screen.getByTestId("access-summary")).toHaveTextContent("Calculado para el rol «admin»");
  });

  it("es solo informativo: sin controles para cambiar permisos, módulos ni tipos", async () => {
    serveAccess(() => json(200, goodAccess()));
    mountPanel();
    await screen.findByTestId("access-row-list_tasks");
    const panel = screen.getByTestId("effective-access");
    for (const role of ["textbox", "combobox", "checkbox", "button", "switch"]) expect(within(panel).queryAllByRole(role)).toHaveLength(0);
  });

  it("el cliente pide siempre el mismo endpoint de solo lectura: sin userId, rol ni orgId", async () => {
    serveAccess(() => json(200, goodAccess()));
    mountPanel();
    await screen.findByTestId("access-row-list_tasks");
    const urls = authFetch.mock.calls.map((c) => String(c[0]));
    expect(urls.filter((u) => u.includes("effective-access"))).toEqual([expect.stringMatching(/\/api\/agents\/7\/effective-access$/)]);
    expect(urls.join(" ")).not.toMatch(/userId|role=|orgId/);
  });
});

