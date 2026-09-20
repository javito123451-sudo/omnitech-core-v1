// LIVE: el frontend nunca es la autoridad (el backend exige agents.execute), pero no debe presentar LIVE como disponible
// a quien no tiene el permiso, y debe explicar con claridad los rechazos del backend.
import { describe, it, expect, vi } from "vitest";
import { renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const session = vi.hoisted(() => ({ permissions: [] as string[], platformRole: "NONE" }));
vi.mock("@/lib/orgContext", () => ({
  useOrg: () => ({
    org: { id: 1, name: "o", slug: "o", plan: "starter", role: "member" }, loading: false,
    platformRole: session.platformRole, platformRoleLoading: false,
    permissions: session.permissions, hasPermission: (p: string) => session.permissions.includes(p),
  }),
}));

import { useAgentPermissions } from "@/lib/agents/hooks";
import { AgentsApiError, describeAgentError } from "@/lib/agents/agentErrors";
import { agentsApi } from "@/lib/agents/agentsApi";

const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>;
const perms = (permissions: string[], platformRole = "NONE") => {
  session.permissions = permissions; session.platformRole = platformRole;
  return renderHook(() => useAgentPermissions(), { wrapper: wrap }).result.current;
};

describe("canExecute (LIVE)", () => {
  it("agents.read solo ve y simula: NO puede ejecutar LIVE", () => {
    expect(perms(["agents.read"])).toEqual({ canRead: true, canWrite: false, canPublish: false, canExecute: false });
  });

  it("agents.write y agents.publish no sustituyen a agents.execute", () => {
    expect(perms(["agents.read", "agents.write", "agents.publish"]).canExecute).toBe(false);
  });

  it("solo agents.execute habilita LIVE, y es independiente de los demás", () => {
    expect(perms(["agents.read", "agents.execute"])).toEqual({ canRead: true, canWrite: false, canPublish: false, canExecute: true });
    expect(perms(["agents.read", "agents.write", "agents.execute"])).toMatchObject({ canWrite: true, canExecute: true, canPublish: false });
  });

  it("SUPER_ADMIN mantiene el bypass existente (igual que en el backend)", () => {
    expect(perms([], "SUPER_ADMIN")).toEqual({ canRead: true, canWrite: true, canPublish: true, canExecute: true });
  });

  it("no hay ninguna llamada a /run ni /confirm en el cliente: LIVE no está expuesto en el frontend", () => {
    expect(Object.keys(agentsApi)).not.toEqual(expect.arrayContaining(["run"]));
    expect(Object.keys(agentsApi).join(" ")).not.toMatch(/run|confirm|live/i);
  });
});

describe("errores de LIVE del backend", () => {
  it("403 agents.execute: mensaje de permiso claro (con el permiso que falta)", () => {
    const info = describeAgentError(new AgentsApiError({ status: 403, code: "permission_denied", message: "Ejecutar agentes en LIVE requiere el permiso agents.execute. Contacta con tu administrador." }));
    expect(info.kind).toBe("permission");
    expect(info.detail).toContain("agents.execute");
    expect(info.technical).toContain("permission_denied");
  });

  it("429 RATE_LIMITED: explica que no se ejecutó ni se cobró nada y que se puede reintentar", () => {
    const info = describeAgentError(new AgentsApiError({ status: 429, code: "RATE_LIMITED", message: "Has alcanzado el límite de ejecuciones por minuto." }));
    expect(info).toMatchObject({ kind: "limit", title: "Demasiadas ejecuciones", retryable: true });
    expect(info.message).toMatch(/no se ha ejecutado nada ni se ha cobrado/i);
    expect(info.technical).toContain("RATE_LIMITED");
  });

  it("409 IDEMPOTENCY_KEY_REUSED e IDEMPOTENCY_IN_PROGRESS tienen mensaje propio y conservan su código", () => {
    const reused = describeAgentError(new AgentsApiError({ status: 409, code: "IDEMPOTENCY_KEY_REUSED", message: "otra petición" }));
    const inflight = describeAgentError(new AgentsApiError({ status: 409, code: "IDEMPOTENCY_IN_PROGRESS", message: "en curso" }));
    expect(reused).toMatchObject({ kind: "conflict", title: "Clave de idempotencia ya usada", retryable: false });
    expect(inflight).toMatchObject({ kind: "conflict", title: "Petición en curso", retryable: true });
    expect(reused.technical).toContain("IDEMPOTENCY_KEY_REUSED");
    expect(inflight.technical).toContain("IDEMPOTENCY_IN_PROGRESS");
  });
});
