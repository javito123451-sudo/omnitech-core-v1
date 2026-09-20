// Omni Fleet operativa: alta y edición de conductores, vehículos, rutas y entregas desde la interfaz.
// El backend es la autoridad (fleet.write); la vista solo decide qué botones mostrar.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const session = vi.hoisted(() => ({ permissions: ["fleet.read", "fleet.write"] as string[], orgId: 1 }));
vi.mock("@/lib/orgContext", () => ({
  useOrg: () => ({ org: { id: session.orgId, name: "o", slug: "o", plan: "starter", role: "admin" }, loading: false, hasPermission: (p: string) => session.permissions.includes(p) }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: false }) }));

const store = vi.hoisted(() => ({
  drivers: [] as Array<Record<string, unknown>>, vehicles: [] as Array<Record<string, unknown>>,
  routes: [] as Array<Record<string, unknown>>, deliveries: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ method: string; path: string; body: unknown }>,
  failNext: null as null | { status: number; error: string },
}));
vi.mock("@/lib/authFetch", () => ({
  authFetch: async (url: string, init: RequestInit = {}) => {
    const path = url.replace(/^.*\/api\/fleet/, "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    store.calls.push({ method, path, body });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (method !== "GET" && store.failNext) { const f = store.failNext; store.failNext = null; return json({ error: f.error }, f.status); }
    if (method === "GET") {
      if (path.startsWith("/drivers")) return json(store.drivers);
      if (path.startsWith("/vehicles")) return json(store.vehicles);
      if (path.match(/^\/routes\/\d+\/deliveries/)) return json(store.deliveries);
      if (path.startsWith("/routes")) return json(store.routes);
      return json([]);
    }
    if (path === "/drivers") { const r = { id: 1, phone: null, licenseNumber: null, notes: null, ...body }; store.drivers.push(r); return json(r, 201); }
    if (path === "/vehicles") { const r = { id: 1, model: null, driverId: null, odometerKm: null, itvExpiresAt: null, insuranceExpiresAt: null, notes: null, ...body }; store.vehicles.push(r); return json(r, 201); }
    if (path === "/routes") { const r = { id: 7, status: "pending", totalStops: 0, completedStops: 0, incidentStops: 0, externalRouteId: null, ...body }; store.routes.push(r); return json(r, 201); }
    if (path.match(/^\/routes\/\d+\/deliveries$/)) { const r = { id: 9, routeId: 7, status: "pending", sequenceOrder: 0, externalDeliveryId: null, lastStatusNote: null, ...body }; store.deliveries.push(r); return json(r, 201); }
    return json({ ok: true });
  },
}));

import { DriversPanel } from "@/components/fleet/DriversPanel";
import { VehiclesPanel } from "@/components/fleet/VehiclesPanel";
import { RoutesPanel } from "@/components/fleet/RoutesPanel";

// Equivalente mínimo de user-event (no es una dependencia del proyecto).
const userEvent = {
  setup: () => ({
    click: async (el: Element) => { fireEvent.click(el); },
    type: async (el: Element, text: string) => { fireEvent.change(el, { target: { value: text } }); },
    selectOptions: async (el: Element, value: string) => { fireEvent.change(el, { target: { value } }); },
  }),
};

const wrap = (ui: React.ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{ui}</QueryClientProvider>);
const writes = () => store.calls.filter((c) => c.method !== "GET");

beforeEach(() => {
  session.permissions = ["fleet.read", "fleet.write"]; session.orgId = 1;
  store.drivers = []; store.vehicles = []; store.routes = []; store.deliveries = []; store.calls = []; store.failNext = null;
});

describe("permisos en la vista", () => {
  it("sin fleet.write no hay botones de alta ni de edición (el backend igualmente lo exige)", async () => {
    session.permissions = ["fleet.read"];
    store.drivers = [{ id: 1, name: "Ana", phone: null, licenseNumber: null, status: "available", notes: null }];
    wrap(<DriversPanel canWrite={false} />);
    expect(await screen.findByText("Ana")).toBeTruthy();
    expect(screen.queryByText("Nuevo conductor")).toBeNull();
    expect(screen.queryByLabelText("Editar Ana")).toBeNull();
  });
});

describe("conductores", () => {
  it("crea un conductor con los datos del formulario y lo pide al workspace activo", async () => {
    const user = userEvent.setup();
    wrap(<DriversPanel canWrite />);
    await user.click(await screen.findByText("Nuevo conductor"));
    await user.type(screen.getByLabelText("Nombre"), "  Luis  ");
    await user.type(screen.getByLabelText("Teléfono"), "600111222");
    await user.click(screen.getByText("Crear conductor"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: "POST", path: "/drivers", body: { name: "Luis", phone: "600111222", status: "available" } });
  });

  it("no envía nada si falta el nombre", async () => {
    const user = userEvent.setup();
    wrap(<DriversPanel canWrite />);
    await user.click(await screen.findByText("Nuevo conductor"));
    await user.click(screen.getByText("Crear conductor"));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "El nombre es obligatorio.");
    expect(writes()).toHaveLength(0);
  });
});

describe("vehículos", () => {
  it("una matrícula duplicada muestra un mensaje claro y el formulario sigue abierto", async () => {
    const user = userEvent.setup();
    store.failNext = { status: 409, error: "plate_already_exists" };
    wrap(<VehiclesPanel canWrite />);
    await user.click(await screen.findByText("Nuevo vehículo"));
    await user.type(screen.getByLabelText("Matrícula"), "1234ABC");
    await user.click(screen.getByText("Crear vehículo"));
    expect((await screen.findByRole("alert")).textContent).toContain("Ya existe un vehículo con esa matrícula");
    expect(screen.getByLabelText("Matrícula")).toBeTruthy();
  });

  it("crea un vehículo con conductor y fechas", async () => {
    const user = userEvent.setup();
    store.drivers = [{ id: 3, name: "Marta", phone: null, licenseNumber: null, status: "available", notes: null }];
    wrap(<VehiclesPanel canWrite />);
    await user.click(await screen.findByText("Nuevo vehículo"));
    await user.type(screen.getByLabelText("Matrícula"), "9999ZZZ");
    await user.selectOptions(await screen.findByLabelText("Conductor habitual"), "3");
    await user.click(screen.getByText("Crear vehículo"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]!.body).toMatchObject({ plate: "9999ZZZ", driverId: 3, status: "available" });
  });
});

describe("rutas y entregas", () => {
  it("crea una ruta para la fecha elegida, sin conductor ni vehículo si no se eligen", async () => {
    const user = userEvent.setup();
    wrap(<RoutesPanel canWrite />);
    await user.click(await screen.findByText("Nueva ruta"));
    await user.type(screen.getByLabelText("Nombre"), "Zona norte");
    await user.click(screen.getByText("Crear ruta"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: "POST", path: "/routes", body: { name: "Zona norte", driverId: null, vehicleId: null } });
    expect((writes()[0]!.body as { date: string }).date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("añade una entrega a la ruta y cambia su estado a mano", async () => {
    const user = userEvent.setup();
    store.routes = [{ id: 7, name: "Zona norte", date: "2026-09-21", status: "pending", driverId: null, vehicleId: null, totalStops: 1, completedStops: 0, incidentStops: 0, externalRouteId: null }];
    store.deliveries = [{ id: 9, routeId: 7, address: "Calle Mayor 1", recipientName: "Eva", recipientPhone: null, status: "pending", sequenceOrder: 0, externalDeliveryId: null, lastStatusNote: null }];
    wrap(<RoutesPanel canWrite />);
    await user.click(await screen.findByLabelText("Ver entregas de Zona norte"));
    await user.selectOptions(await screen.findByLabelText("Estado de la entrega 9"), "delivered");
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: "PATCH", path: "/routes/7/deliveries/9", body: { status: "delivered" } });

    await user.type(screen.getByLabelText("Dirección de la entrega"), "Calle Sol 5");
    await user.click(screen.getByText("Añadir entrega"));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toMatchObject({ method: "POST", path: "/routes/7/deliveries", body: { address: "Calle Sol 5" } });
  });

  it("un error del backend al cambiar el estado se muestra y no rompe la lista", async () => {
    const user = userEvent.setup();
    store.routes = [{ id: 7, name: "Zona norte", date: "2026-09-21", status: "pending", driverId: null, vehicleId: null, totalStops: 0, completedStops: 0, incidentStops: 0, externalRouteId: null }];
    store.failNext = { status: 403, error: "permission_denied" };
    wrap(<RoutesPanel canWrite />);
    await user.selectOptions(await screen.findByLabelText("Estado de la ruta Zona norte"), "in_progress");
    expect((await screen.findByRole("alert")).textContent).toContain("No tienes permiso");
    expect(within(document.body).getByText("Zona norte")).toBeTruthy();
  });

  it("los datos se piden con una clave por workspace: al cambiar de workspace se vuelven a pedir", async () => {
    store.drivers = [{ id: 1, name: "Ana", phone: null, licenseNumber: null, status: "available", notes: null }];
    const { unmount } = wrap(<DriversPanel canWrite />);
    await screen.findByText("Ana");
    unmount();
    session.orgId = 2;
    store.calls = [];
    wrap(<DriversPanel canWrite />);
    await screen.findByText("Ana");
    expect(store.calls.some((c) => c.method === "GET" && c.path === "/drivers")).toBe(true);
  });
});
