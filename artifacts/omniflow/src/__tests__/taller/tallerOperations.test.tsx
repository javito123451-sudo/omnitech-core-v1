// Omni Taller operativo: crear y editar órdenes, buscar y cambiar de fase desde la interfaz.
// El backend es la autoridad (taller.write); la vista solo decide qué botones mostrar.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const session = vi.hoisted(() => ({ permissions: ["taller.read", "taller.write"] as string[], orgId: 1 }));
vi.mock("@/lib/orgContext", () => ({
  useOrg: () => ({ org: { id: session.orgId, name: "o", slug: "o", plan: "starter", role: "admin" }, loading: false, hasPermission: (p: string) => session.permissions.includes(p) }),
}));
vi.mock("@/hooks/useSuperAdmin", () => ({ useSuperAdmin: () => ({ isSuperAdmin: false }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));

const store = vi.hoisted(() => ({
  orders: [] as Array<Record<string, unknown>>, clients: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ method: string; path: string; body: unknown }>,
  failNext: null as null | { status: number; error: string },
}));
vi.mock("@/lib/authFetch", () => ({
  authFetch: async (url: string, init: RequestInit = {}) => {
    const path = url.replace(/^.*\/api\/taller/, "");
    const method = init.method ?? "GET";
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    store.calls.push({ method, path, body });
    const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
    if (method !== "GET" && store.failNext) { const f = store.failNext; store.failNext = null; return json({ error: f.error }, f.status); }
    if (method === "GET") {
      if (path.startsWith("/dashboard")) return json({ totalActive: 1, readyForPickup: 0, inRepair: 1, waitingParts: 0, byStage: {} });
      if (path.startsWith("/clients")) return json(store.clients);
      if (path.startsWith("/orders")) return json(store.orders);
    }
    if (path === "/orders" && method === "POST") return json({ id: 5, ...body }, 201);
    return json({ ok: true });
  },
}));

import TallerPage from "@/pages/taller";

const wrap = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><TallerPage /></QueryClientProvider>);
const writes = () => store.calls.filter((c) => c.method !== "GET");
const order = (over: Record<string, unknown> = {}) => ({
  id: 1, clientId: 10, clientName: "Ana Pérez", clientPhone: null, appointmentId: null, quoteId: null, vehiclePlate: "1234ABC", vehicleModel: "Seat Ibiza",
  vehicleMileageKm: 80000, serviceType: "reparacion", stage: "received", notes: null, deliveredAt: null, createdAt: "2026-09-21T10:00:00Z", updatedAt: "2026-09-21T10:00:00Z", ...over,
});

beforeEach(() => {
  session.permissions = ["taller.read", "taller.write"]; session.orgId = 1;
  store.orders = []; store.clients = []; store.calls = []; store.failNext = null;
});

describe("Omni Taller", () => {
  it("sin taller.write no hay alta, edición ni selector de fase (el backend igualmente lo exige)", async () => {
    session.permissions = ["taller.read"];
    store.orders = [order()];
    wrap();
    expect(await screen.findByText("Ana Pérez")).toBeTruthy();
    expect(screen.queryByText("Nueva orden")).toBeNull();
    expect(screen.queryByLabelText("Editar orden 1")).toBeNull();
    expect(screen.queryByLabelText("Cambiar fase de la orden 1")).toBeNull();
  });

  it("sin órdenes ofrece crear la primera", async () => {
    wrap();
    expect(await screen.findByText(/Todavía no hay órdenes de reparación/)).toBeTruthy();
    expect(screen.getAllByText("Nueva orden").length).toBeGreaterThan(0);
  });

  it("crea una orden: busca el cliente, lo elige y envía vehículo y servicio", async () => {
    store.clients = [{ id: 10, name: "Ana Pérez", phone: "600123123", email: null }];
    wrap();
    fireEvent.click((await screen.findAllByText("Nueva orden"))[0]!);
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "Ana" } });
    fireEvent.click(await screen.findByText("Ana Pérez"));
    fireEvent.change(screen.getByLabelText("Matrícula"), { target: { value: "1234abc" } });
    fireEvent.change(screen.getByLabelText("Kilómetros"), { target: { value: "80000" } });
    fireEvent.change(screen.getByLabelText("Servicio"), { target: { value: "itv" } });
    fireEvent.click(screen.getByText("Crear orden"));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: "POST", path: "/orders", body: { clientId: 10, vehiclePlate: "1234abc", vehicleMileageKm: 80000, serviceType: "itv" } });
  });

  it("no se puede crear sin cliente", async () => {
    wrap();
    fireEvent.click((await screen.findAllByText("Nueva orden"))[0]!);
    fireEvent.click(screen.getByText("Crear orden"));
    expect((await screen.findByRole("alert")).textContent).toBe("Elige el cliente de la orden.");
    expect(writes()).toHaveLength(0);
  });

  it("valida los kilómetros antes de enviar", async () => {
    store.clients = [{ id: 10, name: "Ana Pérez", phone: null, email: null }];
    wrap();
    fireEvent.click((await screen.findAllByText("Nueva orden"))[0]!);
    fireEvent.change(screen.getByLabelText("Cliente"), { target: { value: "Ana" } });
    fireEvent.click(await screen.findByText("Ana Pérez"));
    fireEvent.change(screen.getByLabelText("Kilómetros"), { target: { value: "12,5" } });
    fireEvent.click(screen.getByText("Crear orden"));
    expect((await screen.findByRole("alert")).textContent).toContain("número entero positivo");
    expect(writes()).toHaveLength(0);
  });

  it("cambia la fase desde la lista y edita los datos del vehículo", async () => {
    store.orders = [order()];
    wrap();
    fireEvent.change(await screen.findByLabelText("Cambiar fase de la orden 1"), { target: { value: "in_repair" } });
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({ method: "PATCH", path: "/orders/1", body: { stage: "in_repair" } });

    fireEvent.click(screen.getByLabelText("Editar orden 1"));
    fireEvent.change(screen.getByLabelText("Modelo"), { target: { value: "Seat León" } });
    fireEvent.click(screen.getByText("Guardar"));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1]).toMatchObject({ method: "PATCH", path: "/orders/1", body: { vehicleModel: "Seat León", vehiclePlate: "1234ABC", stage: "received" } });
  });

  it("un error del backend se muestra con un mensaje claro y el formulario sigue abierto", async () => {
    store.orders = [order()];
    store.failNext = { status: 400, error: "quote_not_found" };
    wrap();
    fireEvent.click(await screen.findByLabelText("Editar orden 1"));
    fireEvent.click(screen.getByText("Guardar"));
    expect((await screen.findByRole("alert")).textContent).toContain("presupuesto enlazado no existe");
    expect(screen.getByLabelText("Matrícula")).toBeTruthy();
  });

  it("la búsqueda y el filtro de fase llegan al API", async () => {
    store.orders = [order()];
    wrap();
    await screen.findByText("Ana Pérez");
    fireEvent.change(screen.getByLabelText("Buscar órdenes"), { target: { value: "ibiza" } });
    fireEvent.change(screen.getByLabelText("Filtrar por fase"), { target: { value: "ready" } });
    await waitFor(() => expect(store.calls.some((c) => c.path === "/orders?stage=ready&q=ibiza")).toBe(true));
  });

  it("al cambiar de workspace se vuelven a pedir los datos (clave de caché por workspace)", async () => {
    store.orders = [order()];
    const { unmount } = wrap();
    await screen.findByText("Ana Pérez");
    unmount();
    session.orgId = 2; store.calls = [];
    wrap();
    await screen.findByText("Ana Pérez");
    expect(store.calls.some((c) => c.method === "GET" && c.path.startsWith("/orders"))).toBe(true);
  });
});
