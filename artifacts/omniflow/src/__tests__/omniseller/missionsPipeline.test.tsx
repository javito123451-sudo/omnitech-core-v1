// OmniSeller Fase 13 — tests de la UI operable del pipeline (Missions →
// Research → Contact Finder → Outreach → Follow-up → Booking).
//
// Mismo patrón de mocking que src/__tests__/agents/agentsPage.test.tsx:
// sesión/permisos vía vi.hoisted + vi.mock("@/lib/orgContext"), red vía
// vi.mock("@/lib/authFetch"). Los datos de prueba respetan exactamente la
// forma real de las respuestas del backend (incluido snake_case en las
// rutas que usan SQL crudo: GET /api/leads/results y
// GET /api/leads/results/:id/messages).
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { ReactNode } from "react";

// jsdom no implementa scrollIntoView/hasPointerCapture — Radix Select los
// usa al abrir el listbox. Polyfill mínimo, solo en este archivo (no se
// toca setup.ts global): sin esto, Radix lanza en un efecto post-commit y
// vitest lo reporta como "Unhandled Error" aunque el test en sí pase.
if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};

// ── Mocks: sesión/permisos y red ────────────────────────────────────────────
const session = vi.hoisted(() => ({
  orgId: 1 as number | null,
  loading: false,
  permissions: ["omniseller.read", "omniseller.write", "leads.read"] as string[],
  modules: { omni_seller: true } as Record<string, boolean>,
}));
const authFetch = vi.hoisted(() => vi.fn());

vi.mock("@/lib/orgContext", () => ({
  useOrg: () => ({
    org: session.orgId === null ? null : { id: session.orgId, name: `Org ${session.orgId}`, slug: "o", plan: "starter", role: "member" },
    loading: session.loading,
    modules: session.modules,
    canAccessModule: (key: string) => session.modules[key] === true,
    permissions: session.permissions,
    hasPermission: (p: string) => session.permissions.includes(p),
  }),
}));
vi.mock("@/lib/authFetch", () => ({ authFetch: (...a: unknown[]) => authFetch(...a) }));

import MissionsPage from "@/pages/missions";
import { ModuleGuard } from "@/components/ModuleGuard";
import { Toaster } from "@/components/ui/toaster";

// ── Datos de prueba con la forma real de las respuestas del backend ────────
const mission = (over: Record<string, unknown> = {}) => ({
  id: 1, name: "Dentistas Madrid Centro", objective: "10 reuniones", sector: "Dentistas",
  location: "Madrid", targetProspectCount: 50, creditBudget: "200", status: "active",
  createdAt: "2026-06-01T10:00:00Z", summary: { searchesCount: 1, totalProspects: 1 },
  ...over,
});

const missionDetail = (over: Record<string, unknown> = {}) => ({
  ...mission(),
  searches: [{ id: 10, sector: "Dentistas", city: "Madrid", status: "done", totalFound: 1, createdAt: "2026-06-01T10:00:00Z" }],
  summary: { searchesCount: 1, totalProspects: 1, analyzed: 0, highOpportunity: 0, mediumOpportunity: 0, lowOpportunity: 0 },
  ...over,
});

const leadResultsPage = (rows: Record<string, unknown>[]) => ({ data: rows, total: rows.length, page: 1, pages: 1 });

const prospect = (over: Record<string, unknown> = {}) => ({
  id: 100, name: "Clínica Dental Sonrisa", address: "Gran Vía 1", phone: "600111222", website: "https://sonrisa.example",
  email: null, rating: 4.5, review_count: 20, sector: "Dentistas", status: "new", crm_client_id: null,
  created_at: "2026-06-01T10:00:00Z", score: null, opportunity: null, summary: null,
  ...over,
});

const foundContact = (over: Record<string, unknown> = {}) => ({
  id: 500, name: "Ana Ruiz", role: "Gerente", email: "ana@sonrisa.example", phone: "600333444",
  linkedinUrl: null, status: "found", confidence: 0.8, ...over,
});

function json(status: number, body: unknown) {
  return Promise.resolve({ ok: status >= 200 && status < 300, status, json: () => Promise.resolve(body) });
}

/** Router de respuestas por (método, sufijo de URL) — el primer match gana. */
function serve(routes: Array<{ method?: string; test: (url: string) => boolean; handler: () => Promise<unknown> }>) {
  authFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = (init?.method ?? "GET").toUpperCase();
    const match = routes.find(r => (r.method ?? "GET") === method && r.test(url));
    if (!match) return json(404, { error: `sin mock para ${method} ${url}` });
    return match.handler();
  });
}

function mount(ui: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 0 } } });
  const loc = memoryLocation({ path: "/missions", record: true });
  const utils = render(
    <QueryClientProvider client={client}>
      <Router hook={loc.hook}>{ui}<Toaster /></Router>
    </QueryClientProvider>,
  );
  return { ...utils, client };
}

beforeEach(() => {
  authFetch.mockReset();
  session.orgId = 1;
  session.loading = false;
  session.permissions = ["omniseller.read", "omniseller.write", "leads.read"];
  session.modules = { omni_seller: true };
});

async function openMissionDetail() {
  serve([
    { test: u => u.endsWith("/api/missions"), handler: () => json(200, [mission()]) },
    { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
  ]);
  mount(<MissionsPage />);
  const card = await screen.findByText("Dentistas Madrid Centro");
  fireEvent.click(card);
  await screen.findByText("Búsquedas de esta misión");
}

describe("Missions — listado, creación, detalle, ModuleGuard", () => {
  it("1. renderiza el listado de misiones", async () => {
    serve([{ test: u => u.endsWith("/api/missions"), handler: () => json(200, [mission()]) }]);
    mount(<MissionsPage />);
    expect(await screen.findByText("Dentistas Madrid Centro")).toBeInTheDocument();
    expect(screen.getByText("Misiones")).toBeInTheDocument();
  });

  it("2. estado vacío cuando no hay misiones", async () => {
    serve([{ test: u => u.endsWith("/api/missions"), handler: () => json(200, []) }]);
    mount(<MissionsPage />);
    expect(await screen.findByText("Todavía no has creado ninguna misión.")).toBeInTheDocument();
  });

  it("3. crea una misión nueva (POST /api/missions)", async () => {
    let created: Record<string, unknown> | null = null;
    serve([
      { test: u => u.endsWith("/api/missions"), handler: () => json(200, created ? [mission(), created] : [mission()]) },
      {
        method: "POST", test: u => u.endsWith("/api/missions"),
        handler: () => { created = mission({ id: 2, name: "Nueva misión de prueba" }); return json(201, created); },
      },
    ]);
    mount(<MissionsPage />);
    await screen.findByText("Dentistas Madrid Centro");
    fireEvent.click(screen.getByText("Nueva misión"));
    const nameInput = await screen.findByPlaceholderText("Dentistas Madrid Centro — Q1");
    fireEvent.change(nameInput, { target: { value: "Nueva misión de prueba" } });
    fireEvent.click(screen.getByText("Crear misión"));
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(expect.stringContaining("/api/missions"), expect.objectContaining({ method: "POST" })));
  });

  it("4. detalle de misión muestra resumen y búsquedas", async () => {
    await openMissionDetail();
    expect(screen.getByText("Dentistas Madrid Centro")).toBeInTheDocument();
    expect(screen.getByText("Dentistas en Madrid")).toBeInTheDocument();
    expect(screen.getByTestId("tab-prospectos")).toBeInTheDocument();
  });

  it("5. ModuleGuard bloquea el acceso cuando el módulo omni_seller no está activo", () => {
    session.modules = { omni_seller: false };
    mount(
      <ModuleGuard moduleKey="omni_seller">
        <div>Contenido de Missions</div>
      </ModuleGuard>,
    );
    expect(screen.getByText("Módulo no disponible")).toBeInTheDocument();
    expect(screen.queryByText("Contenido de Missions")).not.toBeInTheDocument();
  });

  it("6. ModuleGuard deja pasar cuando el módulo está activo", () => {
    session.modules = { omni_seller: true };
    mount(
      <ModuleGuard moduleKey="omni_seller">
        <div>Contenido de Missions</div>
      </ModuleGuard>,
    );
    expect(screen.getByText("Contenido de Missions")).toBeInTheDocument();
  });
});

describe("Research", () => {
  it("7. lanzar Research: loading → éxito, invalida prospectos", async () => {
    await openMissionDetail();
    serve([
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.includes("/api/leads/results?searchId=10"), handler: () => json(200, leadResultsPage([prospect()])) },
      {
        method: "POST", test: u => u.endsWith("/api/missions/1/research"),
        handler: () => json(200, { missionId: 1, requested: 1, analyzed: 1, failed: 0, notAttempted: 0, creditsSpent: 1 }),
      },
    ]);
    fireEvent.mouseDown(screen.getByTestId("tab-prospectos"));
    const btn = await screen.findByTestId("run-research-btn");
    fireEvent.click(btn);
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(expect.stringContaining("/api/missions/1/research"), expect.objectContaining({ method: "POST" })));
    await screen.findByText("Research: 1 analizados");
  });

  it("8. error en Research muestra toast de error", async () => {
    await openMissionDetail();
    serve([
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.includes("/api/leads/results?searchId=10"), handler: () => json(200, leadResultsPage([prospect()])) },
      { method: "POST", test: u => u.endsWith("/api/missions/1/research"), handler: () => json(402, { error: "Créditos insuficientes para investigar estos prospectos" }) },
    ]);
    fireEvent.mouseDown(screen.getByTestId("tab-prospectos"));
    fireEvent.click(await screen.findByTestId("run-research-btn"));
    await screen.findByText("No se pudo lanzar Research");
  });

  it("9. muestra los prospectos con su oportunidad tras analizarlos", async () => {
    await openMissionDetail();
    serve([
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.includes("/api/leads/results?searchId=10"), handler: () => json(200, leadResultsPage([prospect({ score: 82, opportunity: "alta" })])) },
    ]);
    fireEvent.mouseDown(screen.getByTestId("tab-prospectos"));
    await screen.findByText("Clínica Dental Sonrisa");
    expect(screen.getByText("🔥 Alta")).toBeInTheDocument();
    expect(screen.getByText("Score 82")).toBeInTheDocument();
  });
});

describe("Contact Finder", () => {
  async function goToProspectos() {
    await openMissionDetail();
    serve([
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.includes("/api/leads/results?searchId=10"), handler: () => json(200, leadResultsPage([prospect()])) },
      {
        method: "POST", test: u => u.endsWith("/api/missions/1/contacts/find"),
        handler: () => json(200, { missionId: 1, leadResultId: 100, provider: "mock", contactsFound: 1, creditsSpent: 0, contacts: [foundContact()] }),
      },
    ]);
    fireEvent.mouseDown(screen.getByTestId("tab-prospectos"));
    await screen.findByText("Clínica Dental Sonrisa");
  }

  it("10. ejecuta la búsqueda y muestra los contactos encontrados", async () => {
    await goToProspectos();
    fireEvent.click(screen.getByTestId("find-contacts-100"));
    await screen.findByText("Ana Ruiz");
    expect(screen.getByText("ana@sonrisa.example")).toBeInTheDocument();
  });

  it("11. estado vacío cuando no se encuentran contactos", async () => {
    await openMissionDetail();
    serve([
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.includes("/api/leads/results?searchId=10"), handler: () => json(200, leadResultsPage([prospect()])) },
      { method: "POST", test: u => u.endsWith("/api/missions/1/contacts/find"), handler: () => json(200, { missionId: 1, leadResultId: 100, provider: "mock", contactsFound: 0, creditsSpent: 0, contacts: [] }) },
    ]);
    fireEvent.mouseDown(screen.getByTestId("tab-prospectos"));
    await screen.findByText("Clínica Dental Sonrisa");
    fireEvent.click(screen.getByTestId("find-contacts-100"));
    await screen.findByText("No se encontraron contactos para este prospecto.");
  });

  it("12. error del proveedor muestra un mensaje limpio (sin detalle interno)", async () => {
    await openMissionDetail();
    serve([
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.includes("/api/leads/results?searchId=10"), handler: () => json(200, leadResultsPage([prospect()])) },
      { method: "POST", test: u => u.endsWith("/api/missions/1/contacts/find"), handler: () => json(409, { error: "provider_not_configured" }) },
    ]);
    fireEvent.mouseDown(screen.getByTestId("tab-prospectos"));
    await screen.findByText("Clínica Dental Sonrisa");
    fireEvent.click(screen.getByTestId("find-contacts-100"));
    await screen.findByText("No se pudo buscar contactos");
  });
});

describe("Seguridad UI — solo lectura sin omniseller.write", () => {
  it("13. oculta/deshabilita acciones de escritura cuando falta omniseller.write", async () => {
    session.permissions = ["omniseller.read", "leads.read"];
    await openMissionDetail();
    serve([
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.includes("/api/leads/results?searchId=10"), handler: () => json(200, leadResultsPage([prospect()])) },
    ]);
    fireEvent.mouseDown(screen.getByTestId("tab-prospectos"));
    await screen.findByText("Clínica Dental Sonrisa");
    expect(screen.getByTestId("run-research-btn")).toBeDisabled();
    expect(screen.getByTestId("find-contacts-100")).toBeDisabled();
  });
});

describe("Follow-up", () => {
  it("14. estado vacío cuando la misión no tiene secuencias", async () => {
    await openMissionDetail();
    serve([{ test: u => u.includes("/api/outreach/followups?missionId=1"), handler: () => json(200, []) }]);
    fireEvent.mouseDown(screen.getByTestId("tab-followup"));
    await screen.findByTestId("followup-empty");
  });

  it("15. lista secuencias con intento/estado/próximo envío y permite cancelar", async () => {
    await openMissionDetail();
    const followup = {
      id: 900, orgId: 1, leadMessageId: 50, leadContactId: 500, missionId: 1, channel: "email",
      attempt: 1, maxAttempts: 3, status: "scheduled", nextRunAt: "2026-06-05T09:00:00Z", reason: null,
      generatedLeadMessageId: null, createdAt: "2026-06-02T09:00:00Z", updatedAt: "2026-06-02T09:00:00Z",
    };
    serve([
      { test: u => u.includes("/api/outreach/followups?missionId=1"), handler: () => json(200, [followup]) },
      { method: "POST", test: u => u.endsWith("/api/outreach/followups/900/cancel"), handler: () => json(200, { leadMessageId: 50, cancelledCount: 1 }) },
    ]);
    fireEvent.mouseDown(screen.getByTestId("tab-followup"));
    await screen.findByText("Intento 1/3");
    fireEvent.click(screen.getByTestId("cancel-followup-900"));
    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(expect.stringContaining("/api/outreach/followups/900/cancel"), expect.objectContaining({ method: "POST" })));
  });

  it("16. sin omniseller.write, cancelar está deshabilitado", async () => {
    session.permissions = ["omniseller.read", "leads.read"];
    await openMissionDetail();
    const followup = {
      id: 900, orgId: 1, leadMessageId: 50, leadContactId: 500, missionId: 1, channel: "email",
      attempt: 1, maxAttempts: 3, status: "scheduled", nextRunAt: "2026-06-05T09:00:00Z", reason: null,
      generatedLeadMessageId: null, createdAt: "2026-06-02T09:00:00Z", updatedAt: "2026-06-02T09:00:00Z",
    };
    serve([{ test: u => u.includes("/api/outreach/followups?missionId=1"), handler: () => json(200, [followup]) }]);
    fireEvent.mouseDown(screen.getByTestId("tab-followup"));
    await screen.findByText("Intento 1/3");
    expect(screen.getByTestId("cancel-followup-900")).toBeDisabled();
  });
});

describe("Booking", () => {
  it("17. sin contactos encontrados en la sesión, muestra estado vacío", async () => {
    await openMissionDetail();
    fireEvent.mouseDown(screen.getByTestId("tab-booking"));
    await screen.findByTestId("booking-no-contacts");
  });

  it("18. crea una cita de invitado (guest booking) sin enviar clientId, con 0 créditos", async () => {
    await openMissionDetail();
    serve([
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.includes("/api/leads/results?searchId=10"), handler: () => json(200, leadResultsPage([prospect()])) },
      { method: "POST", test: u => u.endsWith("/api/missions/1/contacts/find"), handler: () => json(200, { missionId: 1, leadResultId: 100, provider: "mock", contactsFound: 1, creditsSpent: 0, contacts: [foundContact()] }) },
      { method: "POST", test: u => u.endsWith("/api/outreach/bookings"), handler: () => json(201, { id: 700, orgId: 1, clientId: null, guestName: "Ana Ruiz" }) },
    ]);
    // Encontrar el contacto desde Prospectos para que Booking pueda elegirlo.
    fireEvent.mouseDown(screen.getByTestId("tab-prospectos"));
    await screen.findByText("Clínica Dental Sonrisa");
    fireEvent.click(screen.getByTestId("find-contacts-100"));
    await screen.findByText("Ana Ruiz");

    fireEvent.mouseDown(screen.getByTestId("tab-booking"));
    fireEvent.click(await screen.findByTestId("booking-contact-select"));
    fireEvent.click(await screen.findByText("Ana Ruiz — Clínica Dental Sonrisa"));
    fireEvent.change(screen.getByTestId("booking-date"), { target: { value: "2026-06-10" } });
    fireEvent.change(screen.getByTestId("booking-time"), { target: { value: "10:00" } });
    fireEvent.click(screen.getByTestId("create-booking-btn"));

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(expect.stringContaining("/api/outreach/bookings"), expect.anything()));
    const [, init] = authFetch.mock.calls.find(([u]: [string]) => u.endsWith("/api/outreach/bookings"))!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.clientId).toBeUndefined();
    expect(body.leadContactId).toBe(500);
    await screen.findByTestId("booking-created");
  });
});

// OmniSeller Fase 14 — Gap 1 y Gap 2: los contactos ya encontrados deben
// sobrevivir a una recarga de página (GET /api/missions/:id/contacts,
// hidratado en MissionDetailView), y deben estar disponibles en Outreach y
// Booking aunque el usuario NO vuelva a pasar por la pestaña Prospectos.
describe("Fase 14 — recuperación de contactos tras recargar", () => {
  it("19. hidrata los contactos persistidos al abrir la Mission, sin pulsar 'Buscar contactos'", async () => {
    serve([
      { test: u => u.endsWith("/api/missions"), handler: () => json(200, [mission()]) },
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.endsWith("/api/missions/1/contacts"), handler: () => json(200, { missionId: 1, contacts: [{ ...foundContact(), leadResultId: 100 }] }) },
      { test: u => u.includes("/api/leads/results?searchId=10"), handler: () => json(200, leadResultsPage([prospect()])) },
    ]);
    mount(<MissionsPage />);
    fireEvent.click(await screen.findByText("Dentistas Madrid Centro"));
    await screen.findByText("Búsquedas de esta misión");

    // Sin pasar por Prospectos ni pulsar "Buscar contactos": Outreach ya
    // debe ofrecer el contacto persistido.
    fireEvent.mouseDown(screen.getByTestId("tab-outreach"));
    fireEvent.click(await screen.findByTestId("contact-select"));
    expect(await screen.findByText("Ana Ruiz — Prospecto #100")).toBeInTheDocument();
  });

  it("20. los contactos hidratados también aparecen en Booking sin visitar Prospectos", async () => {
    serve([
      { test: u => u.endsWith("/api/missions"), handler: () => json(200, [mission()]) },
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.endsWith("/api/missions/1/contacts"), handler: () => json(200, { missionId: 1, contacts: [{ ...foundContact(), leadResultId: 100 }] }) },
      { test: u => u.includes("/api/leads/results?searchId=10"), handler: () => json(200, leadResultsPage([prospect()])) },
    ]);
    mount(<MissionsPage />);
    fireEvent.click(await screen.findByText("Dentistas Madrid Centro"));
    await screen.findByText("Búsquedas de esta misión");

    fireEvent.mouseDown(screen.getByTestId("tab-booking"));
    expect(await screen.findByTestId("booking-contact-select")).toBeInTheDocument();
    expect(screen.queryByTestId("booking-no-contacts")).not.toBeInTheDocument();
  });

  it("21. si el prospecto aún no se cargó, el contacto hidratado usa un rótulo genérico en vez de inventar un nombre", async () => {
    serve([
      { test: u => u.endsWith("/api/missions"), handler: () => json(200, [mission()]) },
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.endsWith("/api/missions/1/contacts"), handler: () => json(200, { missionId: 1, contacts: [{ ...foundContact(), leadResultId: 100 }] }) },
    ]);
    mount(<MissionsPage />);
    fireEvent.click(await screen.findByText("Dentistas Madrid Centro"));
    await screen.findByText("Búsquedas de esta misión");
    fireEvent.mouseDown(screen.getByTestId("tab-outreach"));
    fireEvent.click(await screen.findByTestId("contact-select"));
    expect(await screen.findByText("Ana Ruiz — Prospecto #100")).toBeInTheDocument();
  });

  it("22. sin contactos persistidos (GET vacío), Outreach y Booking muestran el estado vacío normal", async () => {
    serve([
      { test: u => u.endsWith("/api/missions"), handler: () => json(200, [mission()]) },
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.endsWith("/api/missions/1/contacts"), handler: () => json(200, { missionId: 1, contacts: [] }) },
    ]);
    mount(<MissionsPage />);
    fireEvent.click(await screen.findByText("Dentistas Madrid Centro"));
    await screen.findByText("Búsquedas de esta misión");
    fireEvent.mouseDown(screen.getByTestId("tab-outreach"));
    await screen.findByTestId("outreach-no-contacts");
  });
});

// OmniSeller Fase 16 — Trazabilidad (GET /api/missions/:id/audit) e
// Historial de Outreach filtrado por contacto (?contactId=).
describe("Fase 16 — Trazabilidad e historial por contacto", () => {
  it("23. la pestaña Trazabilidad muestra las entradas de auditoría de la misión", async () => {
    await openMissionDetail();
    serve([
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      {
        test: u => u.endsWith("/api/missions/1/audit"),
        handler: () => json(200, {
          missionId: 1,
          entries: [
            { id: 1, action: "missions.create", resource: "mission", resourceId: "1", actorEmail: "paco@example.com", details: {}, severity: "info", createdAt: "2026-06-01T10:00:00Z" },
            { id: 2, action: "outreach.send_succeeded", resource: "lead_message", resourceId: "9", actorEmail: "paco@example.com", details: { missionId: 1 }, severity: "info", createdAt: "2026-06-02T10:00:00Z" },
          ],
        }),
      },
    ]);
    fireEvent.mouseDown(screen.getByTestId("tab-trazabilidad"));
    await screen.findByText("missions.create");
    expect(screen.getByText("outreach.send_succeeded")).toBeInTheDocument();
  });

  it("24. la pestaña Trazabilidad muestra el estado vacío cuando no hay entradas", async () => {
    await openMissionDetail();
    serve([
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.endsWith("/api/missions/1/audit"), handler: () => json(200, { missionId: 1, entries: [] }) },
    ]);
    fireEvent.mouseDown(screen.getByTestId("tab-trazabilidad"));
    await screen.findByTestId("traceability-empty");
  });

  it("25. el historial de Outreach se pide filtrado por el contacto seleccionado (?contactId=)", async () => {
    await openMissionDetail();
    serve([
      { test: u => /\/api\/missions\/1$/.test(u), handler: () => json(200, missionDetail()) },
      { test: u => u.includes("/api/leads/results?searchId=10"), handler: () => json(200, leadResultsPage([prospect()])) },
      { method: "POST", test: u => u.endsWith("/api/missions/1/contacts/find"), handler: () => json(200, { missionId: 1, leadResultId: 100, provider: "mock", contactsFound: 1, creditsSpent: 0, contacts: [foundContact()] }) },
      { test: u => u.includes("/api/leads/results/100/messages"), handler: () => json(200, []) },
    ]);
    fireEvent.mouseDown(screen.getByTestId("tab-prospectos"));
    await screen.findByText("Clínica Dental Sonrisa");
    fireEvent.click(screen.getByTestId("find-contacts-100"));
    await screen.findByText("Ana Ruiz");

    fireEvent.mouseDown(screen.getByTestId("tab-outreach"));
    fireEvent.click(await screen.findByTestId("contact-select"));
    fireEvent.click(await screen.findByText("Ana Ruiz — Clínica Dental Sonrisa"));

    await waitFor(() => expect(authFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/leads/results/100/messages?contactId=500"),
    ));
  });
});
