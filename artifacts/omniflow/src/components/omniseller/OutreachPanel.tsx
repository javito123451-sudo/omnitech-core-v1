/**
 * OmniSeller Fase 13 — Panel "Outreach".
 *
 * Reutiliza EXACTAMENTE la cadena de 3 pasos ya existente en
 * routes/missions.ts (Fase 4) — nunca se salta la confirmación humana ni se
 * llama a un proveedor directamente desde el frontend:
 *
 *   1. POST /api/missions/:id/contacts/:contactId/messages   → crea el draft
 *   2. POST /api/missions/:id/messages/:messageId/request-confirmation
 *      → mueve el mensaje a "pending_confirmation" y devuelve un confirmToken
 *   3. POST /api/missions/:id/messages/:messageId/confirm    → confirmación
 *      humana + envío real (outreachService.confirmAndSendMessage, que a su
 *      vez reutiliza outreachService.executeSend / reserve→send→settle)
 *
 * Este panel NUNCA decide por sí mismo si un mensaje se envía: solo permite
 * al usuario revisar el contenido y pulsar "Confirmar y enviar" — el propio
 * token de un solo uso, ligado a este mensaje, es la confirmación humana.
 *
 * El historial se lee con GET /api/leads/results/:id/messages?contactId=...
 * (routes/leads.ts, permiso leads.read, ya existente) — el filtro por
 * contacto se cerró en Fase 16 reutilizando lead_messages.contact_id (columna
 * e índice que ya existían), sin migración ni endpoint nuevo.
 */
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Send, ShieldCheck, MessageSquareText, AlertCircle, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { OUTREACH_CHANNELS, type ContactWithLeadContext, type LeadMessageDraft, type LeadMessageHistoryRow, type OutreachChannel } from "./types";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const CHANNEL_LABEL: Record<OutreachChannel, string> = { email: "Email", whatsapp: "WhatsApp", telegram: "Telegram" };

type SendStage = "idle" | "draft" | "pending_confirmation" | "sent" | "error";

export function OutreachPanel({
  missionId, canWrite, contacts,
}: {
  missionId: number; canWrite: boolean; contacts: ContactWithLeadContext[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [selectedContactId, setSelectedContactId] = useState<number | "">("");
  const [channel, setChannel] = useState<OutreachChannel>("email");
  const [content, setContent] = useState("");
  const [stage, setStage] = useState<SendStage>("idle");
  const [message, setMessage] = useState<LeadMessageDraft | null>(null);
  const [confirmToken, setConfirmToken] = useState<string | null>(null);
  const [resultDetail, setResultDetail] = useState<string | null>(null);

  const selectedContact = contacts.find(c => c.id === selectedContactId) ?? null;

  const historyQuery = useQuery<LeadMessageHistoryRow[]>({
    queryKey: ["leadResultMessages", selectedContact?.leadResultId, selectedContact?.id],
    queryFn: () => authFetch(`${BASE}/api/leads/results/${selectedContact!.leadResultId}/messages?contactId=${selectedContact!.id}`).then(r => r.json()),
    enabled: !!selectedContact,
  });

  function resetFlow() {
    setStage("idle"); setMessage(null); setConfirmToken(null); setResultDetail(null); setContent("");
  }

  const draftMut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/missions/${missionId}/contacts/${selectedContact!.id}/messages`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, content }),
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.error ?? "No se pudo crear el borrador");
        return d as LeadMessageDraft;
      }),
    onSuccess: (d) => { setMessage(d); setStage("draft"); toast({ title: "Borrador creado" }); },
    onError: (err: Error) => toast({ title: "Error al preparar el mensaje", description: err.message, variant: "destructive" }),
  });

  const requestConfirmationMut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/missions/${missionId}/messages/${message!.id}/request-confirmation`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({}),
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail ?? d.error ?? "No se pudo solicitar la confirmación");
        return d as { leadMessageId: number; confirmToken: string; expiresAt: string };
      }),
    onSuccess: (d) => { setConfirmToken(d.confirmToken); setStage("pending_confirmation"); },
    onError: (err: Error) => { setResultDetail(err.message); toast({ title: "No se pudo pedir confirmación", description: err.message, variant: "destructive" }); },
  });

  const confirmMut = useMutation({
    mutationFn: () =>
      authFetch(`${BASE}/api/missions/${missionId}/messages/${message!.id}/confirm`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmToken }),
      }).then(async r => {
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail ?? d.error ?? "Error al enviar");
        return d as { status: string; externalMessageId?: string; creditsSpent?: number };
      }),
    onSuccess: (d) => {
      setStage("sent");
      qc.invalidateQueries({ queryKey: ["leadResultMessages", selectedContact?.leadResultId] });
      toast({ title: "Mensaje enviado", description: `${d.creditsSpent ?? 0} créditos gastados` });
    },
    onError: (err: Error) => { setStage("error"); setResultDetail(err.message); toast({ title: "No se pudo enviar", description: err.message, variant: "destructive" }); },
  });

  return (
    <div className="space-y-4" data-testid="outreach-panel">
      <div>
        <h3 className="text-white font-semibold text-sm flex items-center gap-2"><MessageSquareText size={14} className="text-violet-400" /> Outreach</h3>
        <p className="text-slate-500 text-xs mt-0.5">Redacta, confirma y envía un mensaje a un contacto encontrado — nunca se envía sin confirmación humana.</p>
      </div>

      {contacts.length === 0 ? (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-8 text-center" data-testid="outreach-no-contacts">
          <p className="text-slate-400 text-sm">Todavía no hay contactos encontrados en esta sesión.</p>
          <p className="text-slate-600 text-xs mt-1">Ve a la pestaña Prospectos y pulsa "Buscar contactos" sobre un prospecto.</p>
        </div>
      ) : (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5 space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="text-slate-400 text-xs">Contacto</label>
              <Select
                value={selectedContactId === "" ? undefined : String(selectedContactId)}
                onValueChange={(v) => { setSelectedContactId(Number(v)); resetFlow(); }}
              >
                <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1" data-testid="contact-select">
                  <SelectValue placeholder="Elige un contacto" />
                </SelectTrigger>
                <SelectContent>
                  {contacts.map(c => (
                    <SelectItem key={c.id} value={String(c.id)}>
                      {c.name ?? "Sin nombre"} — {c.leadName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-slate-400 text-xs">Canal</label>
              <Select value={channel} onValueChange={(v) => setChannel(v as OutreachChannel)}>
                <SelectTrigger className="bg-white/5 border-white/10 text-white mt-1" data-testid="channel-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OUTREACH_CHANNELS.map(ch => <SelectItem key={ch} value={ch}>{CHANNEL_LABEL[ch]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {selectedContact && (
            <>
              <div>
                <label className="text-slate-400 text-xs">Mensaje</label>
                <Textarea
                  value={content} onChange={e => setContent(e.target.value)} disabled={stage !== "idle"}
                  placeholder="Escribe el mensaje para este contacto..."
                  className="bg-white/5 border-white/10 text-white mt-1 min-h-[100px]"
                  data-testid="message-content"
                />
              </div>

              {stage === "idle" && (
                <Button
                  onClick={() => draftMut.mutate()}
                  disabled={!canWrite || !content.trim() || draftMut.isPending}
                  className="bg-violet-600 hover:bg-violet-700"
                  data-testid="create-draft-btn"
                >
                  {draftMut.isPending ? <Loader2 size={16} className="animate-spin mr-2" /> : <MessageSquareText size={16} className="mr-2" />}
                  Preparar mensaje
                </Button>
              )}

              {stage === "draft" && (
                <div className="flex items-center gap-3">
                  <Button
                    onClick={() => requestConfirmationMut.mutate()}
                    disabled={!canWrite || requestConfirmationMut.isPending}
                    className="bg-amber-600 hover:bg-amber-700"
                    data-testid="request-confirmation-btn"
                  >
                    {requestConfirmationMut.isPending ? <Loader2 size={16} className="animate-spin mr-2" /> : <ShieldCheck size={16} className="mr-2" />}
                    Solicitar confirmación
                  </Button>
                  <Button variant="ghost" onClick={resetFlow} className="text-slate-400">Cancelar</Button>
                </div>
              )}

              {stage === "pending_confirmation" && (
                <div className="space-y-3">
                  <p className="text-amber-400 text-xs flex items-center gap-1.5"><AlertCircle size={14} /> Revisa el mensaje antes de confirmar el envío — esta acción es irreversible.</p>
                  <div className="flex items-center gap-3">
                    <Button
                      onClick={() => confirmMut.mutate()}
                      disabled={!canWrite || confirmMut.isPending}
                      className="bg-emerald-600 hover:bg-emerald-700"
                      data-testid="confirm-send-btn"
                    >
                      {confirmMut.isPending ? <Loader2 size={16} className="animate-spin mr-2" /> : <Send size={16} className="mr-2" />}
                      Confirmar y enviar
                    </Button>
                    <Button variant="ghost" onClick={resetFlow} className="text-slate-400">Cancelar</Button>
                  </div>
                </div>
              )}

              {stage === "sent" && (
                <p className="text-emerald-400 text-sm flex items-center gap-1.5" data-testid="outreach-sent"><CheckCircle2 size={16} /> Mensaje enviado correctamente.</p>
              )}
              {stage === "error" && (
                <p className="text-red-400 text-sm flex items-center gap-1.5" data-testid="outreach-error"><AlertCircle size={16} /> {resultDetail ?? "No se pudo completar el envío."}</p>
              )}
            </>
          )}
        </div>
      )}

      {selectedContact && (
        <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
          <h4 className="text-white text-sm font-medium mb-3">Historial de mensajes de este prospecto</h4>
          {historyQuery.isLoading ? (
            <Loader2 size={18} className="animate-spin text-violet-400" />
          ) : !historyQuery.data || historyQuery.data.length === 0 ? (
            <p className="text-slate-600 text-xs">Todavía no hay mensajes para este prospecto.</p>
          ) : (
            <div className="space-y-2">
              {historyQuery.data.map(m => (
                <div key={m.id} className="flex items-center justify-between text-xs bg-white/[0.02] rounded-lg px-3 py-2">
                  <span className="text-slate-300">{m.channel} · {m.status}</span>
                  <span className="text-slate-600">{m.created_at ? new Date(m.created_at).toLocaleString("es-ES") : ""}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
