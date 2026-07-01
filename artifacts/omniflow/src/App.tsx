import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk, useAuth } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { registerTokenGetter } from "@/lib/authFetch";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { OrgProvider, useOrg } from "@/lib/orgContext";
import NotFound from "@/pages/not-found";
import MainLayout from "@/components/layout/MainLayout";
import ControlCenterLayout from "@/components/layout/ControlCenterLayout";
import Dashboard from "@/pages/dashboard";
import RoleDashboard from "@/pages/role-dashboard";
import Clients from "@/pages/clients";
import MyClientsPage from "@/pages/my-clients";
import MyProspectsPage from "@/pages/my-prospects";
import MyCustomersPage from "@/pages/my-customers";
import MyCommissionsPage from "@/pages/my-commissions";
import PipelinePage from "@/pages/pipeline";
import OnboardingPage from "@/pages/onboarding";
import SupportPage from "@/pages/support";
import Assistant from "@/pages/assistant";
import Calendar from "@/pages/calendar";
import Statistics from "@/pages/statistics";
import Setup from "@/pages/setup";
import Settings from "@/pages/settings";
import InvitePage from "@/pages/invite";
import MemoryPage from "@/pages/memory";
import Quotes from "@/pages/quotes";
import ExecutivePage from "@/pages/executive";
import ExecutiveDashboardPage from "@/pages/executive-dashboard";
import IntegrationsPage from "@/pages/integrations";
import OmniIntegrationWizard from "@/pages/omni-integration-wizard";
import WhatsAppLogsPage from "@/pages/whatsapp-logs";
import TelegramInboxPage from "@/pages/telegram-inbox";
import TelegramSettingsPage from "@/pages/telegram-settings";
import TelegramDiagnosticoPage from "@/pages/telegram-diagnostico";
import KnowledgeBasePage from "@/pages/knowledge-base";
import ControlCenterDashboard from "@/pages/control-center/index";
import WorkspacesPage from "@/pages/control-center/workspaces";
import WorkspaceDetailPage from "@/pages/control-center/workspace-detail";
import UsersPage from "@/pages/control-center/users";
import ModulesPage from "@/pages/control-center/modules";
import SecurityPage from "@/pages/control-center/security";
import AuditPage from "@/pages/control-center/audit";
import RolesPage from "@/pages/control-center/roles";
import CCIntegrationsPage from "@/pages/control-center/integrations";
import LicensesPage from "@/pages/control-center/licenses";
import DiagnosticsPage from "@/pages/control-center/diagnostics";
import AiCenterPage from "@/pages/control-center/ai-center";
import BackupsPage from "@/pages/control-center/backups";
import ModuleMatrixPage from "@/pages/control-center/module-matrix";
import ImportAiPage from "@/pages/import-ai";
import AutomationsPage from "@/pages/automations";
import AccountingPage from "@/pages/accounting/index";
import TaxPage from "@/pages/tax/index";
import MarketingHubPage from "@/pages/marketing";
import OnboardWizardPage from "@/pages/control-center/onboard-wizard";
import PortalPage from "@/pages/portal";
import PlansPage from "@/pages/plans";
import NoAccess from "@/pages/no-access";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import ManualHome from "@/pages/manual/index";
import ManualChapter from "@/pages/manual/chapter";
import { ModuleGuard } from "@/components/ModuleGuard";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);

const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error("Missing VITE_CLERK_PUBLISHABLE_KEY");
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(217, 91%, 60%)",
    colorForeground: "hsl(0, 0%, 100%)",
    colorMutedForeground: "hsl(215, 16%, 65%)",
    colorDanger: "hsl(0, 84%, 60%)",
    colorBackground: "hsl(222, 35%, 11%)",
    colorInput: "hsl(220, 20%, 18%)",
    colorInputForeground: "hsl(0, 0%, 100%)",
    colorNeutral: "hsl(220, 20%, 18%)",
    fontFamily: "Inter, sans-serif",
    borderRadius: "0.5rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox:
      "bg-[hsl(222,35%,11%)] rounded-2xl w-[440px] max-w-full overflow-hidden border border-[hsl(220,20%,18%)]",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none",
    headerTitle: "text-white font-bold",
    headerSubtitle: "text-[hsl(215,16%,65%)]",
    socialButtonsBlockButtonText: "text-white",
    formFieldLabel: "text-[hsl(215,16%,65%)] text-sm",
    footerActionLink:
      "text-[hsl(217,91%,60%)] hover:text-[hsl(217,91%,70%)]",
    footerActionText: "text-[hsl(215,16%,65%)]",
    dividerText: "text-[hsl(215,16%,65%)]",
    identityPreviewEditButton: "text-[hsl(217,91%,60%)]",
    formFieldSuccessText: "text-green-400",
    alertText: "text-white",
    logoBox: "flex justify-center mb-2",
    logoImage: "w-10 h-10",
    socialButtonsBlockButton:
      "border-[hsl(220,20%,22%)] bg-[hsl(220,20%,14%)] hover:bg-[hsl(220,20%,18%)] text-white",
    formButtonPrimary:
      "bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,50%)] text-white font-semibold",
    formFieldInput: "bg-[hsl(220,20%,18%)] border-[hsl(220,20%,22%)] text-white",
    footerAction: "border-t border-[hsl(220,20%,18%)]",
    dividerLine: "bg-[hsl(220,20%,22%)]",
    alert: "bg-[hsl(0,20%,15%)] border-[hsl(0,84%,30%)]",
    otpCodeFieldInput:
      "bg-[hsl(220,20%,18%)] border-[hsl(220,20%,22%)] text-white",
    formFieldRow: "gap-2",
    main: "gap-4",
  },
};

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignIn
        routing="path"
        path={`${basePath}/sign-in`}
        signUpUrl={`${basePath}/sign-up`}
        fallbackRedirectUrl={`${basePath}/`}
      />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <SignUp
        routing="path"
        path={`${basePath}/sign-up`}
        signInUrl={`${basePath}/sign-in`}
        fallbackRedirectUrl={`${basePath}/`}
      />
    </div>
  );
}

function HomeRedirect() {
  const { isSignedIn } = useAuth();
  const [, setLocation] = useLocation();
  const { isSuperAdmin, loading } = useSuperAdmin();

  useEffect(() => {
    if (isSignedIn === false) { setLocation("/sign-in"); return; }
    if (isSignedIn === true && !loading) {
      setLocation(isSuperAdmin ? "/control-center" : "/dashboard");
    }
  }, [isSignedIn, loading, isSuperAdmin, setLocation]);

  return (
    <div className="flex items-center justify-center h-screen bg-[#0a0b14]">
      <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { needsSetup, loading } = useOrg();
  const { isSuperAdmin, loading: adminLoading } = useSuperAdmin();

  useEffect(() => {
    if (!loading && !adminLoading && needsSetup) {
      if (isSuperAdmin) {
        setLocation("/setup");
      } else {
        setLocation("/no-access");
      }
    }
  }, [loading, adminLoading, needsSetup, isSuperAdmin, setLocation]);

  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function SuperAdminRoute({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { isSuperAdmin, loading } = useSuperAdmin();

  useEffect(() => {
    if (!loading && !isSuperAdmin) {
      setLocation("/dashboard");
    }
  }, [loading, isSuperAdmin, setLocation]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-[#0a0b14]">
        <div className="w-8 h-8 border-2 border-violet-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isSuperAdmin) return null;

  return (
    <>
      <Show when="signed-in">{children}</Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={HomeRedirect} />
      <Route path="/portal" component={PortalPage} />
      <Route path="/sign-in/*?" component={SignInPage} />
      <Route path="/sign-up/*?" component={SignUpPage} />
      <Route path="/setup">
        <Show when="signed-in">
          <Setup />
        </Show>
        <Show when="signed-out">
          <Redirect to="/sign-in" />
        </Show>
      </Route>
      <Route path="/no-access">
        <Show when="signed-in">
          <NoAccess />
        </Show>
        <Show when="signed-out">
          <Redirect to="/sign-in" />
        </Show>
      </Route>
      <Route path="/dashboard">
        <ProtectedRoute>
          <MainLayout>
            <RoleDashboard />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/clients">
        <ProtectedRoute>
          <MainLayout>
            <Clients />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/my-clients">
        <ProtectedRoute>
          <MainLayout>
            <MyClientsPage />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/my-prospects">
        <ProtectedRoute>
          <MainLayout>
            <MyProspectsPage />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/my-customers">
        <ProtectedRoute>
          <MainLayout>
            <MyCustomersPage />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/my-commissions">
        <ProtectedRoute>
          <MainLayout>
            <MyCommissionsPage />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/pipeline">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="crm">
              <PipelinePage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/onboarding">
        <ProtectedRoute>
          <MainLayout>
            <OnboardingPage />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/support">
        <ProtectedRoute>
          <MainLayout>
            <SupportPage />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/assistant">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="ai_agents">
              <Assistant />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/calendar">
        <ProtectedRoute>
          <MainLayout>
            <Calendar />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/statistics">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="analytics">
              <Statistics />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/settings">
        <ProtectedRoute>
          <MainLayout>
            <Settings />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/invite/:token" component={InvitePage} />
      <Route path="/memory">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="ai_agents">
              <MemoryPage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/quotes">
        <ProtectedRoute>
          <MainLayout>
            <Quotes />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/executive">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="analytics">
              <ExecutivePage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/executive-dashboard">
        <ProtectedRoute>
          <MainLayout>
            <ExecutiveDashboardPage />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/integrations">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="integrations">
              <IntegrationsPage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/integrations/wizard/:slug">
        <ProtectedRoute>
          <OmniIntegrationWizard />
        </ProtectedRoute>
      </Route>
      <Route path="/integrations/whatsapp/logs">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="whatsapp">
              <WhatsAppLogsPage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/integrations/telegram">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="integrations">
              <TelegramSettingsPage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/integrations/telegram/diagnostico">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="integrations">
              <TelegramDiagnosticoPage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/telegram-inbox">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="ai_agents">
              <TelegramInboxPage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/knowledge-base">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="ai_agents">
              <KnowledgeBasePage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/import">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="omni_import_ai">
              <ImportAiPage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/automations">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="automations">
              <AutomationsPage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/accounting">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="omni_accounting">
              <AccountingPage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/tax">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="omni_tax">
              <TaxPage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/marketing">
        <ProtectedRoute>
          <MainLayout>
            <ModuleGuard moduleKey="omni_marketing">
              <MarketingHubPage />
            </ModuleGuard>
          </MainLayout>
        </ProtectedRoute>
      </Route>
      <Route path="/plans">
        <ProtectedRoute>
          <MainLayout>
            <PlansPage />
          </MainLayout>
        </ProtectedRoute>
      </Route>
      {/* ── Control Center (Super Admin only) ─────────────────────────────── */}
      <Route path="/control-center">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <ControlCenterDashboard />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/workspaces/:id">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <WorkspaceDetailPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/workspaces">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <WorkspacesPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/users">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <UsersPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/roles">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <RolesPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/modules">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <ModulesPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/ai-center">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <AiCenterPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/integrations">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <CCIntegrationsPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/security">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <SecurityPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/audit">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <AuditPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/licenses">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <LicensesPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/diagnostics">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <DiagnosticsPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/backups">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <BackupsPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/module-matrix">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <ModuleMatrixPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>
      <Route path="/control-center/onboard-wizard">
        <SuperAdminRoute>
          <ControlCenterLayout>
            <OnboardWizardPage />
          </ControlCenterLayout>
        </SuperAdminRoute>
      </Route>

      {/* ── Manual / Wiki ─────────────────────────────────────────── */}
      <Route path="/manual">
        <ProtectedRoute>
          <ManualHome />
        </ProtectedRoute>
      </Route>
      <Route path="/manual/:slug">
        {(params) => (
          <ProtectedRoute>
            <ManualChapter />
          </ProtectedRoute>
        )}
      </Route>

      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);
  const loginLoggedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
        loginLoggedRef.current = false;
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

  const { getToken } = useAuth();
  useEffect(() => {
    if (loginLoggedRef.current) return;
    let cancelled = false;
    (async () => {
      const token = await getToken().catch(() => null);
      if (!token || cancelled) return;
      loginLoggedRef.current = true;
      fetch(`${import.meta.env.BASE_URL}api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
        credentials: "include",
      }).catch(() => {});
    })();
    return () => { cancelled = true; };
  }, [getToken]);

  return null;
}

function ClerkTokenSync() {
  const { getToken } = useAuth();
  useEffect(() => {
    const getter = () => getToken();
    setAuthTokenGetter(getter);
    registerTokenGetter(getter);
    return () => {
      setAuthTokenGetter(null);
      registerTokenGetter(null);
    };
  }, [getToken]);
  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      signInFallbackRedirectUrl={`${basePath}/`}
      signUpFallbackRedirectUrl={`${basePath}/`}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
      localization={{
        signIn: {
          start: {
            title: "Bienvenido a OmniTech Core",
            subtitle: "Inicia sesión para acceder a tu plataforma",
          },
        },
        signUp: {
          start: {
            title: "Crea tu cuenta",
            subtitle: "Empieza a usar OmniTech Core hoy",
          },
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <ClerkQueryClientCacheInvalidator />
        <ClerkTokenSync />
        <OrgProvider>
          <TooltipProvider>
            <AppRoutes />
            <Toaster />
          </TooltipProvider>
        </OrgProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;
