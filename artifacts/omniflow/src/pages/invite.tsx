import { useEffect, useState } from "react";
import { useParams, useLocation } from "wouter";
import { Hexagon, Loader2, CheckCircle2, AlertCircle, Users } from "lucide-react";
import { useUser } from "@clerk/react";
import { useOrg } from "@/lib/orgContext";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

interface InvitationInfo {
  id: number;
  email: string;
  role: string;
  expiresAt: string;
  orgName: string;
  orgSlug: string;
  inviterName: string | null;
  inviterEmail: string;
}

export default function InvitePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? "";
  const [, setLocation] = useLocation();
  const { isSignedIn, isLoaded } = useUser();
  const { refetch } = useOrg();

  const [info, setInfo] = useState<InvitationInfo | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [acceptError, setAcceptError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setFetchError("Token no válido."); return; }
    fetch(`${BASE_URL}/api/invitations/${token}`)
      .then(async (res) => {
        const body = await res.json();
        if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
        setInfo(body);
      })
      .catch((err) => setFetchError(err.message ?? String(err)));
  }, [token]);

  const handleAccept = async () => {
    setAccepting(true);
    setAcceptError(null);
    try {
      const res = await fetch(`${BASE_URL}/api/invitations/${token}/accept`, {
        method: "POST",
        credentials: "include",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      setAccepted(true);
      refetch();
      setTimeout(() => setLocation("/dashboard"), 2000);
    } catch (err) {
      setAcceptError(err instanceof Error ? err.message : String(err));
    } finally {
      setAccepting(false);
    }
  };

  const ROLE_LABEL: Record<string, string> = { owner: "Owner", admin: "Admin", member: "Miembro" };

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 mb-4">
            <Hexagon className="w-7 h-7 text-primary fill-primary/20" />
          </div>
          <p className="text-xs text-primary font-semibold uppercase tracking-widest mb-1">OmniTech Core</p>
          <h1 className="text-2xl font-bold text-foreground">Invitación de equipo</h1>
        </div>

        <div className="bg-card border border-border rounded-2xl p-6 space-y-5">
          {(!info && !fetchError) && (
            <div className="flex justify-center py-6">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
            </div>
          )}

          {fetchError && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <AlertCircle className="w-10 h-10 text-destructive/70" />
              <p className="text-sm font-medium text-foreground">Invitación no disponible</p>
              <p className="text-xs text-muted-foreground">{fetchError}</p>
              <button
                type="button"
                onClick={() => setLocation("/")}
                className="mt-2 text-xs text-primary hover:underline"
              >
                Ir al inicio →
              </button>
            </div>
          )}

          {info && !accepted && (
            <>
              <div className="flex items-center gap-3 p-3 rounded-xl bg-primary/5 border border-primary/15">
                <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/25 flex items-center justify-center shrink-0">
                  <Users className="w-5 h-5 text-primary" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">{info.orgName}</p>
                  <p className="text-[11px] text-muted-foreground">
                    Invitado por {info.inviterName ?? info.inviterEmail} · Rol: <span className="text-foreground font-medium">{ROLE_LABEL[info.role] ?? info.role}</span>
                  </p>
                </div>
              </div>

              {!isLoaded ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                </div>
              ) : !isSignedIn ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground text-center">
                    Inicia sesión o crea una cuenta para unirte al equipo.
                  </p>
                  <button
                    type="button"
                    onClick={() => setLocation(`/sign-in`)}
                    className="w-full py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm transition-all"
                  >
                    Iniciar sesión
                  </button>
                  <button
                    type="button"
                    onClick={() => setLocation(`/sign-up`)}
                    className="w-full py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-border text-foreground font-medium text-sm transition-all"
                  >
                    Crear cuenta nueva
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {acceptError && (
                    <div className="text-destructive text-sm bg-destructive/10 border border-destructive/20 rounded-lg px-3 py-2">
                      {acceptError}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={handleAccept}
                    disabled={accepting}
                    className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-sm transition-all disabled:opacity-50"
                  >
                    {accepting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Users className="w-4 h-4" />}
                    Unirme a {info.orgName}
                  </button>
                </div>
              )}
            </>
          )}

          {accepted && (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <CheckCircle2 className="w-12 h-12 text-emerald-400" />
              <p className="text-base font-semibold text-foreground">¡Te has unido al equipo!</p>
              <p className="text-xs text-muted-foreground">Redirigiendo al panel…</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
