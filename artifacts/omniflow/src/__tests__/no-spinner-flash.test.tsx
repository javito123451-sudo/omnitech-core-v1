/**
 * Regression test: sidebar must never flash a spinner when navigating between
 * pages if localStorage contains a valid sidebar cache entry.
 *
 * Covers the three components that gate navigation with a loading spinner:
 *   - ModuleGuard  (route content guard — shows spinner while loading)
 *   - SuperAdminRoute  (admin-only guard — shows full-screen violet spinner)
 *   - HomeRedirect  (root redirect — shows full-screen blue spinner)
 *
 * Strategy:
 *   1. Seed localStorage with a valid sidebar cache.
 *   2. Mock @clerk/react to simulate a signed-in user without a real Clerk tenant.
 *   3. Stub fetch to hang forever so the background /api/auth/me refresh never
 *      settles — any spinner visible after act() proves loading=true leaked through.
 *   4. Render each guard type and assert zero .animate-spin elements.
 *   5. Run a unified multi-route navigation scenario across 3 routes.
 *   6. Include a cold-start baseline that confirms spinner detection works.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { type ReactNode, useRef } from "react";
import { OrgProvider, useOrg } from "@/lib/orgContext";
import { ModuleGuard } from "@/components/ModuleGuard";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";

// ---------------------------------------------------------------------------
// Mock @clerk/react
// ---------------------------------------------------------------------------
const TEST_CLERK_ID = "user_test_clerk_123";
const TEST_ORG_ID = 42;

const clerkUser = {
  id: TEST_CLERK_ID,
  primaryEmailAddress: { emailAddress: "test@example.com" },
  fullName: "Test User",
  imageUrl: null,
};

vi.mock("@clerk/react", () => ({
  useUser: () => ({ isLoaded: true, isSignedIn: true, user: clerkUser }),
  useAuth: () => ({ getToken: () => Promise.resolve("test-token") }),
  useClerk: () => ({ signOut: vi.fn() }),
  ClerkProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  SignIn: () => null,
  SignUp: () => null,
  Show: ({ children, when }: { children: ReactNode; when: string }) =>
    when === "signed-in" ? <>{children}</> : null,
  Redirect: ({ to }: { to: string }) => <div data-testid="redirect">{to}</div>,
}));

// ---------------------------------------------------------------------------
// Test harnesses that mirror the real spinner-showing logic in App.tsx.
// These components use the exact same hooks as their production counterparts so
// the tests catch any regression that re-introduces a loading flash.
// ---------------------------------------------------------------------------

/**
 * Mirrors SuperAdminRoute in App.tsx:
 *   if (loading) → full-screen violet spinner
 *   if (!isSuperAdmin) → null
 *   else → children
 */
function TestSuperAdminRoute({ children }: { children: ReactNode }) {
  const { isSuperAdmin, loading } = useSuperAdmin();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div
          data-testid="super-admin-spinner"
          className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin"
        />
      </div>
    );
  }

  if (!isSuperAdmin) return null;
  return <>{children}</>;
}

/**
 * Mirrors HomeRedirect in App.tsx:
 *   shows a full-screen blue spinner while loading, then renders a "done" sentinel.
 *   (In production, useEffect calls setLocation; here we just suppress the redirect
 *   and test the spinner vs. no-spinner outcome after effects settle.)
 */
function TestHomeRedirect() {
  const { loading } = useSuperAdmin();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div
          data-testid="home-redirect-spinner"
          className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"
        />
      </div>
    );
  }

  return <div data-testid="home-redirect-done" />;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Seed localStorage exactly as orgContext.tsx expects. */
function seedSidebarCache() {
  localStorage.setItem(`omni_sidebar_ptr_${TEST_CLERK_ID}`, String(TEST_ORG_ID));
  localStorage.setItem(
    `omni_sidebar_${TEST_CLERK_ID}_${TEST_ORG_ID}`,
    JSON.stringify({
      modules: {
        crm: true,
        omni_accounting: true,
        omni_marketing: true,
        analytics: true,
        whatsapp: true,
      },
      org: {
        id: TEST_ORG_ID,
        name: "Test Workspace",
        slug: "test-workspace",
        plan: "pro",
        role: "admin",
        logoUrl: null,
      },
      expiresAt: Date.now() + 5 * 60 * 1000,
      version: 1,
    }),
  );
}

/** Count spinner elements (all guard types) in the rendered output. */
function spinnerCount(container: HTMLElement): number {
  return container.querySelectorAll(".animate-spin").length;
}

// ---------------------------------------------------------------------------
// Keep fetch hanging so the background refresh never settles.
// ---------------------------------------------------------------------------
beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>(() => {
          /* intentionally never resolves */
        }),
    ),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// ModuleGuard tests
// ---------------------------------------------------------------------------

describe("ModuleGuard — no spinner flash", () => {
  it("shows no spinner after mount when cache is pre-seeded", async () => {
    seedSidebarCache();

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <OrgProvider>
          <ModuleGuard moduleKey="crm">
            <div data-testid="crm-content">CRM page</div>
          </ModuleGuard>
        </OrgProvider>,
      ));
    });

    expect(spinnerCount(container)).toBe(0);
    expect(screen.getByTestId("crm-content")).toBeInTheDocument();
  });

  it("shows a spinner when no cache is present (baseline)", async () => {
    // No seedSidebarCache() — cold start with hanging fetch.
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <OrgProvider>
          <ModuleGuard moduleKey="crm">
            <div data-testid="cold-content">content</div>
          </ModuleGuard>
        </OrgProvider>,
      ));
    });

    expect(spinnerCount(container)).toBeGreaterThan(0);
    expect(screen.queryByTestId("cold-content")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SuperAdminRoute tests
// ---------------------------------------------------------------------------

describe("SuperAdminRoute — no spinner flash", () => {
  it("shows no spinner after mount when cache is pre-seeded", async () => {
    seedSidebarCache();

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <OrgProvider>
          <TestSuperAdminRoute>
            <div data-testid="admin-content">Admin page</div>
          </TestSuperAdminRoute>
        </OrgProvider>,
      ));
    });

    // loading=false so spinner is gone; isSuperAdmin=false (platformRole not
    // set by cache) so children are null — but crucially no spinner visible.
    expect(spinnerCount(container)).toBe(0);
    expect(screen.queryByTestId("super-admin-spinner")).not.toBeInTheDocument();
  });

  it("shows a spinner when no cache is present (baseline)", async () => {
    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <OrgProvider>
          <TestSuperAdminRoute>
            <div>Admin content</div>
          </TestSuperAdminRoute>
        </OrgProvider>,
      ));
    });

    expect(screen.getByTestId("super-admin-spinner")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// HomeRedirect tests
// ---------------------------------------------------------------------------

describe("HomeRedirect — no spinner flash", () => {
  it("shows no spinner after mount when cache is pre-seeded", async () => {
    seedSidebarCache();

    let container!: HTMLElement;
    await act(async () => {
      ({ container } = render(
        <OrgProvider>
          <TestHomeRedirect />
        </OrgProvider>,
      ));
    });

    expect(spinnerCount(container)).toBe(0);
    expect(screen.queryByTestId("home-redirect-spinner")).not.toBeInTheDocument();
    expect(screen.getByTestId("home-redirect-done")).toBeInTheDocument();
  });

  it("shows a spinner when no cache is present (baseline)", async () => {
    await act(async () => {
      render(
        <OrgProvider>
          <TestHomeRedirect />
        </OrgProvider>,
      );
    });

    expect(screen.getByTestId("home-redirect-spinner")).toBeInTheDocument();
    expect(screen.queryByTestId("home-redirect-done")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Multi-route navigation scenario
// ---------------------------------------------------------------------------

describe("multi-route navigation — no spinner flash across all guard types", () => {
  /**
   * Simulates a user navigating across 3 app routes, each guarded by a
   * different component type. OrgProvider is mounted once (as in production).
   * After each navigation, asserts zero spinners in any guard.
   *
   * Routes:
   *   / (HomeRedirect)  →  /dashboard (ModuleGuard crm)  →  /control-center (SuperAdminRoute)
   */
  it("navigates across 3 routes without any spinner appearing", async () => {
    seedSidebarCache();

    type Route = {
      testId: string;
      component: ReactNode;
    };

    const routeSequence: Route[] = [
      {
        testId: "route-home",
        component: (
          <>
            <TestHomeRedirect />
            <span data-testid="route-home" />
          </>
        ),
      },
      {
        testId: "route-dashboard",
        component: (
          <ModuleGuard moduleKey="crm">
            <span data-testid="route-dashboard">Dashboard</span>
          </ModuleGuard>
        ),
      },
      {
        testId: "route-control-center",
        component: (
          <TestSuperAdminRoute>
            <span data-testid="route-control-center">Control Center</span>
          </TestSuperAdminRoute>
        ),
      },
    ];

    let container!: HTMLElement;
    let rerender!: (ui: React.ReactElement) => void;

    const wrapInProvider = (content: ReactNode) => (
      <OrgProvider>{content}</OrgProvider>
    );

    // Initial mount.
    await act(async () => {
      const result = render(wrapInProvider(routeSequence[0].component));
      container = result.container;
      rerender = result.rerender;
    });

    // Navigate through each route and assert no spinners.
    for (const route of routeSequence) {
      await act(async () => {
        rerender(wrapInProvider(route.component));
      });

      expect(spinnerCount(container)).toBe(
        0,
        `Spinner appeared when navigating to route "${route.testId}"`,
      );
    }
  });

  /**
   * loading must stay false for every render after the cache is warm.
   * Tracks loading values across all re-renders triggered by navigation.
   */
  it("OrgContext.loading stays false throughout all route transitions", async () => {
    seedSidebarCache();

    const loadingHistory: boolean[] = [];

    function Inspector({ label }: { label: string }) {
      const { loading } = useOrg();
      const mounted = useRef(false);
      if (mounted.current) {
        loadingHistory.push(loading);
      }
      mounted.current = true;
      return <span data-testid={`label-${label}`}>{label}</span>;
    }

    let rerender!: (ui: React.ReactElement) => void;

    const makeUI = (label: string) => (
      <OrgProvider>
        <Inspector label={label} />
      </OrgProvider>
    );

    await act(async () => {
      const result = render(makeUI("home"));
      rerender = result.rerender;
    });

    for (const path of ["/dashboard", "/calendar", "/quotes"]) {
      await act(async () => {
        rerender(makeUI(path));
      });
    }

    expect(loadingHistory.length).toBeGreaterThan(0);
    expect(loadingHistory.every((v) => v === false)).toBe(true);
  });
});
