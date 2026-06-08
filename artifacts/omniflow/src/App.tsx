import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { shadcn } from "@clerk/themes";
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from "wouter";
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { queryClient } from "@/lib/queryClient";
import { OrgProvider, useOrg } from "@/lib/orgContext";
import NotFound from "@/pages/not-found";
import MainLayout from "@/components/layout/MainLayout";
import Dashboard from "@/pages/dashboard";
import Clients from "@/pages/clients";
import Assistant from "@/pages/assistant";
import Calendar from "@/pages/calendar";
import Statistics from "@/pages/statistics";
import Setup from "@/pages/setup";
import Settings from "@/pages/settings";
import InvitePage from "@/pages/invite";

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
        fallbackRedirectUrl={`${basePath}/dashboard`}
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
        fallbackRedirectUrl={`${basePath}/dashboard`}
      />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <Redirect to="/sign-in" />
      </Show>
    </>
  );
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const [, setLocation] = useLocation();
  const { needsSetup, loading } = useOrg();

  useEffect(() => {
    if (!loading && needsSetup) {
      setLocation("/setup");
    }
  }, [loading, needsSetup, setLocation]);

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
      <Route path="/dashboard">
        <ProtectedRoute>
          <MainLayout>
            <Dashboard />
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
      <Route path="/assistant">
        <ProtectedRoute>
          <MainLayout>
            <Assistant />
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
            <Statistics />
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
      <Route component={NotFound} />
    </Switch>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const qc = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        qc.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, qc]);

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
      signInFallbackRedirectUrl={`${basePath}/dashboard`}
      signUpFallbackRedirectUrl={`${basePath}/dashboard`}
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
