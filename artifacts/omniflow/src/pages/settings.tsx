import { useState, useEffect, useCallback } from "react";
import { Building2, Users, Save, Loader2, Copy, Check, Trash2, UserPlus, Crown, Shield, User, X, RefreshCw } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useOrg } from "@/lib/orgContext";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";

const BASE_URL = import.meta.env.BASE_URL.replace(/\/$/, "");

type Tab = "general" | "team";

const PLAN_BADGE: Record<string, string> = {
  free:       "bg-slate-500/20 text-slate-300 border-slate-500/30",
  pro:        "bg-blue-500/15 text-blue-400 border-blue-500/25",
  enterprise: "bg-violet-500/15 text-violet-400 border-violet-500/25",
};

const ROLE_META: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  owner:  { label: "Owner",  icon: Crown,  color: "text-amber-400" },
  admin:  { label: "Admin",  icon: Shield, color: "text-blue-400" },
  member: { label: "Miembro", icon: User,  color: "text-muted-foreground" },
};

interface Member {
  userId: number;
  role: string;
  joinedAt: string;
  email: string;
  name: string | null;
  avatarUrl: string | null;
}

interface Invitation {
  id: number;
  email: string;
  role: string;
  token: string;
  expiresAt: string;
  createdAt: string;
}

function RoleBadge({ role }: { role: string }) {
  const meta = ROLE_META[role] ?? ROLE_META.member;
  const Icon = meta.icon;
  return (
    <span className={cn("flex items-center gap-1 text-[11px] font-medium", meta.color)}>
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function Avatar({ name, email, size = "md" }: { name: string | null; email: string; size?: "sm" | "md" }) {
  const letter = (name ?? email)[0]?.toUpperCase() ?? "?";
  return (
    <div className={cn(
      "rounded-full bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0 font-bold text-primary",
      size === "sm" ? "w-7 h-7 text-xs" : "w-8 h-8 text-sm"
    )}>
      {letter}
    </div>
  );
}

export default function Settings() {
  const { org, user, refetch } = useOrg();
  const [tab, setTab] = useState<Tab>("general");

  const [orgName, setOrgName] = useState(org?.name ?? "");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<string | null>(null);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const [members, setMembers] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [teamLoading, setTeamLoading] = useState(false);

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState("member");
  const [inviting, setInviting] = useState(false);
  const [inviteErr, setInviteErr] = useState<string | null>(null);

  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const canManage = org && (user?.id != null) && (members.find(m => m.userId === user.id)?.role === "owner" || members.find(m => m.userId === user.id)?.role === "admin");
  const isOwner   = org && (user?.id != null) && members.find(m => m.userId === user.id)?.role === "owner";

  useEffect(() => {
    setOrgName(org?.name ?? "");
  }, [org?.name]);

  const loadTeam = useCallback(async () => {
    if (!org) return;
    setTeamLoading(true);
    try {
      const [mRes, iRes] = await Promise.all([
        authFetch(`${BASE_URL}/api/organizations/members`),
        authFetch(`${BASE_URL}/api/organizations/invitations`),
      ]);
      if (mRes.ok) setMembers(await mRes.json());
      if (iRes.ok) setInvitations(await iRes.json());
    } finally {
      setTeamLoading(false);
    }
  }, [org]);

  useEffect(() => {
    if (tab === "team") loadTeam();
  }, [tab, loadTeam]);

  const handleSaveName = async () => {
    if (!orgName.trim() || orgName.trim() === org?.name) return;
    setSaving(true);
    setSaveErr(null);
    setSaveMsg(null);
    try {
      const res = await authFetch(`${BASE_URL}/api/organizations/me`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: orgName.trim() }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      setSaveMsg("Nombre actualizado correctamente.");
      refetch();
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteErr(null);
    try {
      const res = await authFetch(`${BASE_URL}/api/organizations/invitations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? `Error ${res.status}`);
      setInvitations((prev) => [body, ...prev]);
      setInviteEmail("");
      setInviteRole("member");
    } catch (err) {
      setInviteErr(err instanceof Error ? err.message : String(err));
    } finally {
      setInviting(false);
    }
  };

  const handleCancelInvitation = async (id: number) => {
    try {
      await authFetch(`${BASE_URL}/api/organizations/invitations/${id}`, { method: "DELETE" });
      setInvitations((prev) => prev.filter((i) => i.id !== id));
    } catch {}
  };

  const handleRemoveMember = async (userId: number) => {
    try {
      await authFetch(`${BASE_URL}/api/organizations/members/${userId}`, { method: "DELETE" });
      setMembers((prev) => prev.filter((m) => m.userId !== userId));
    } catch {}
  };

  const copyInviteLink = (token: string) => {
    const link = `${window.location.origin}${BASE_URL}/invite/${token}`;
    navigator.clipboard.writeText(link).then(() => {
      setCopiedToken(token);
      setTimeout(() => setCopiedToken(null), 2000);
    });
  };

  if (!org) return (
    <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
      <Loader2 className="w-5 h-5 animate-spin mr-2" /> Cargando...
    </div>
  );

  return (
    <div className="space-y-4 md:space-y-6 animate-in fade-in zoom-in duration-500 max-w-2xl">
      <div>
        <h1 className="text-xl md:text-3xl font-bold tracking-tight text-white">Configuración</h1>
        <p className="text-muted-foreground text-xs md:text-sm mt-0.5">Gestiona tu organización y equipo.</p>
      </div>

      <div className="flex gap-1 border-b border-border">
        {(["general", "team"] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "px-4 py-2 text-sm font-medium transition-all border-b-2 -mb-px",
              tab === t
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "general" ? "General" : "Equipo"}
          </button>
        ))}
      </div>

      {tab === "general" && (
        <div className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3 pt-4 px-5">
              <CardTitle className="text-sm flex items-center gap-2">
                <Building2 className="w-4 h-4 text-primary" />
                Información de la organización
              </CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-5 space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Nombre</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={orgName}
                    onChange={(e) => { setOrgName(e.target.value); setSaveMsg(null); setSaveErr(null); }}
                    maxLength={80}
                    className="flex-1 px-3 py-2 rounded-lg bg-[hsl(220,20%,18%)] border border-border text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all text-sm"
                  />
                  <button
                    type="button"
                    onClick={handleSaveName}
                    disabled={saving || !orgName.trim() || orgName.trim() === org.name}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    Guardar
                  </button>
                </div>
                {saveMsg && <p className="text-xs text-emerald-400">{saveMsg}</p>}
                {saveErr && <p className="text-xs text-destructive">{saveErr}</p>}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Slug</label>
                  <div className="px-3 py-2 rounded-lg bg-[hsl(220,20%,14%)] border border-border text-sm text-muted-foreground font-mono">
                    {org.slug}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Plan</label>
                  <div className="px-3 py-2 rounded-lg bg-[hsl(220,20%,14%)] border border-border">
                    <span className={cn("px-2 py-0.5 rounded-full text-xs font-semibold border capitalize", PLAN_BADGE[org.plan] ?? PLAN_BADGE.free)}>
                      {org.plan}
                    </span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "team" && (
        <div className="space-y-4">
          <Card className="bg-card border-border">
            <CardHeader className="pb-3 pt-4 px-5">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Users className="w-4 h-4 text-primary" />
                  Miembros ({members.length})
                </CardTitle>
                <button type="button" onClick={loadTeam} className="text-muted-foreground hover:text-foreground transition-colors">
                  <RefreshCw className={cn("w-3.5 h-3.5", teamLoading && "animate-spin")} />
                </button>
              </div>
            </CardHeader>
            <CardContent className="px-5 pb-4">
              {teamLoading && members.length === 0 ? (
                <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
              ) : (
                <div className="space-y-2">
                  {members.map((m) => (
                    <div key={m.userId} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                      <Avatar name={m.name} email={m.email} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground truncate">{m.name ?? m.email}</p>
                        <p className="text-[11px] text-muted-foreground truncate">{m.email}</p>
                      </div>
                      <RoleBadge role={m.role} />
                      {isOwner && m.userId !== user?.id && m.role !== "owner" && (
                        <button
                          type="button"
                          onClick={() => handleRemoveMember(m.userId)}
                          className="text-muted-foreground hover:text-destructive transition-colors ml-1"
                          title="Eliminar miembro"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {canManage && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-3 pt-4 px-5">
                <CardTitle className="text-sm flex items-center gap-2">
                  <UserPlus className="w-4 h-4 text-primary" />
                  Invitar miembro
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <form onSubmit={handleInvite} className="space-y-3">
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => { setInviteEmail(e.target.value); setInviteErr(null); }}
                      placeholder="correo@empresa.com"
                      required
                      className="flex-1 px-3 py-2 rounded-lg bg-[hsl(220,20%,18%)] border border-border text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary/50 transition-all text-sm"
                    />
                    <select
                      value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}
                      className="px-3 py-2 rounded-lg bg-[hsl(220,20%,18%)] border border-border text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-primary/40"
                    >
                      <option value="member">Miembro</option>
                      <option value="admin">Admin</option>
                    </select>
                    <button
                      type="submit"
                      disabled={inviting || !inviteEmail.trim()}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary hover:bg-primary/90 text-primary-foreground text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap"
                    >
                      {inviting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserPlus className="w-3.5 h-3.5" />}
                      Invitar
                    </button>
                  </div>
                  {inviteErr && <p className="text-xs text-destructive">{inviteErr}</p>}
                </form>
              </CardContent>
            </Card>
          )}

          {invitations.length > 0 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-3 pt-4 px-5">
                <CardTitle className="text-sm text-muted-foreground">
                  Invitaciones pendientes ({invitations.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-4">
                <div className="space-y-2">
                  {invitations.map((inv) => (
                    <div key={inv.id} className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0">
                      <div className="w-8 h-8 rounded-full bg-muted/30 border border-border flex items-center justify-center shrink-0">
                        <User className="w-3.5 h-3.5 text-muted-foreground" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-foreground truncate">{inv.email}</p>
                        <p className="text-[11px] text-muted-foreground">
                          Expira {new Date(inv.expiresAt).toLocaleDateString("es-ES")}
                        </p>
                      </div>
                      <RoleBadge role={inv.role} />
                      <button
                        type="button"
                        onClick={() => copyInviteLink(inv.token)}
                        className="text-muted-foreground hover:text-primary transition-colors"
                        title="Copiar enlace de invitación"
                      >
                        {copiedToken === inv.token ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                      </button>
                      {canManage && (
                        <button
                          type="button"
                          onClick={() => handleCancelInvitation(inv.id)}
                          className="text-muted-foreground hover:text-destructive transition-colors"
                          title="Cancelar invitación"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-muted-foreground/60 mt-3">
                  Copia el enlace y compártelo con tu invitado. Válido 7 días.
                </p>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
