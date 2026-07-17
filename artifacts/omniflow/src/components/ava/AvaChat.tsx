import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, AlertCircle, Copy, Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";
import AvaAvatar from "./AvaAvatar";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Role = "user" | "ai";
type Msg  = { id: string; role: Role; content: string; ts: Date; streaming?: boolean; error?: boolean };

function inlineFormat(text: unknown): React.ReactNode {
  if (typeof text !== "string") {
    console.warn("[AvaChat] inlineFormat recibió un valor no-string:", typeof text, text);
    return null;
  }
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((p, i) => {
    if (p === undefined) return null;
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="text-white font-semibold">{p.slice(2, -2)}</strong>;
    if (p.startsWith("*")  && p.endsWith("*") && p.length > 2) return <em key={i} className="italic text-slate-300">{p.slice(1, -1)}</em>;
    return p;
  });
}

function renderMarkdown(text: unknown): React.ReactNode[] {
  if (typeof text !== "string") {
    console.warn("[AvaChat] renderMarkdown recibió un valor no-string:", typeof text, text);
    return [];
  }
  return text.split("\n").map((line, i) => {
    if (typeof line !== "string") return null;
    if (/^#{1,3} /.test(line)) return <strong key={i} className="block text-white font-bold mt-2 mb-0.5">{line.replace(/^#{1,3} /, "")}</strong>;
    if (/^[-*] /.test(line))   return <span key={i} className="flex gap-2 my-0.5"><span className="text-primary mt-0.5 shrink-0">•</span><span>{inlineFormat(line.slice(2))}</span></span>;
    if (line === "")            return <span key={i} className="block h-1.5" />;
    return <span key={i} className="block leading-relaxed">{inlineFormat(line)}</span>;
  });
}

function CopyBtn({ text }: { text: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button
      onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }}
      className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-white transition-all"
    >
      {ok ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-3 py-2.5">
      {[0, 1, 2].map(i => (
        <motion.div key={i} className="w-1.5 h-1.5 rounded-full bg-primary"
          animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1.1, 0.8] }}
          transition={{ repeat: Infinity, duration: 1.2, delay: i * 0.2 }}
        />
      ))}
    </div>
  );
}

interface AvaChatProps {
  pendingMessage:   string | null;
  onClearPending:   () => void;
  moduleLabel:      string;
}

export default function AvaChat({ pendingMessage, onClearPending, moduleLabel }: AvaChatProps) {
  const [msgs, setMsgs]       = useState<Msg[]>([]);
  const [input, setInput]     = useState("");
  const [thinking, setThinking] = useState(false);
  const abortRef              = useRef<AbortController | null>(null);
  const bottomRef             = useRef<HTMLDivElement>(null);
  const sessionIdRef          = useRef<string | undefined>(undefined);
  const textareaRef           = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  useEffect(() => { scrollToBottom(); }, [msgs, scrollToBottom]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || thinking) return;

    abortRef.current?.abort();

    const history = [
      ...msgs.filter(m => !m.streaming && !m.error).map(m => ({
        role:    (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: trimmed },
    ];

    const userMsg: Msg = { id: crypto.randomUUID(), role: "user", content: trimmed, ts: new Date() };
    setMsgs(prev => [...prev, userMsg]);
    setInput("");
    if (textareaRef.current) { textareaRef.current.style.height = "24px"; }

    setThinking(true);
    setTimeout(scrollToBottom, 60);
    await new Promise(r => setTimeout(r, 500));

    const aiId  = crypto.randomUUID();
    const aiMsg: Msg = { id: aiId, role: "ai", content: "", ts: new Date(), streaming: true };
    setMsgs(prev => [...prev, aiMsg]);
    setThinking(false);
    setTimeout(scrollToBottom, 60);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const markError = (msg: string) =>
      setMsgs(prev => prev.map(m => m.id === aiId ? { ...m, content: msg, streaming: false, error: true } : m));

    try {
      const ctxPayload = moduleLabel ? { page: moduleLabel } : undefined;
      console.log("[AvaChat] sendMessage → clientContext enviado:", ctxPayload, "| sessionId:", sessionIdRef.current);

      const res = await authFetch(`${API_BASE}/api/chat`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages:      history,
          sessionId:     sessionIdRef.current,
          clientContext: ctxPayload,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: "Error de conexión" }));
        markError(body.error ?? "Error inesperado del servidor");
        return;
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let lineBuffer = "";
      let acc        = "";
      let done       = false;

      while (!done) {
        const chunk = await reader.read();
        done = chunk.done;
        if (chunk.value) lineBuffer += decoder.decode(chunk.value, { stream: !done });

        let nl: number;
        while ((nl = lineBuffer.indexOf("\n")) !== -1) {
          const line    = lineBuffer.slice(0, nl).trimEnd();
          lineBuffer    = lineBuffer.slice(nl + 1);
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload === "[DONE]") { done = true; break; }

          let parsed: { token?: string; error?: string; event?: string; sessionId?: string };
          try { parsed = JSON.parse(payload); } catch { continue; }

          if (parsed.error) { markError(parsed.error); return; }
          if (parsed.event === "session_created" && parsed.sessionId) {
            sessionIdRef.current = parsed.sessionId;
          }
          if (parsed.token) {
            acc += parsed.token;
            const snap = acc;
            setMsgs(prev => prev.map(m => m.id === aiId ? { ...m, content: snap } : m));
            setTimeout(scrollToBottom, 30);
          }
        }
      }

      setMsgs(prev => prev.map(m => m.id === aiId ? { ...m, streaming: false } : m));

    } catch (err) {
      if ((err as Error).name === "AbortError") return;
      markError("No se pudo conectar con Ava. Verifica tu conexión.");
    }
  }, [msgs, thinking, scrollToBottom, moduleLabel]);

  useEffect(() => {
    if (pendingMessage) {
      onClearPending();
      void sendMessage(pendingMessage);
    }
  // sendMessage is stable via useCallback; pendingMessage drives this
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  const adjustHeight = (el: HTMLTextAreaElement) => {
    el.style.height = "24px";
    el.style.height = Math.min(el.scrollHeight, 128) + "px";
  };

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {/* ── Messages ── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4 scrollbar-thin">
        {msgs.length === 0 && !thinking && (
          <div className="flex flex-col items-center justify-center h-full py-12 text-center gap-3">
            <AvaAvatar size={36} />
            <p className="text-sm text-muted-foreground/60 leading-relaxed">
              Escribe un mensaje o usa<br />una acción rápida.
            </p>
          </div>
        )}

        <AnimatePresence initial={false}>
          {msgs.map(msg => (
            <motion.div
              key={msg.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={cn("flex gap-2.5 group", msg.role === "user" ? "flex-row-reverse" : "flex-row")}
            >
              {msg.role === "ai" && <AvaAvatar size={26} className="shrink-0 mt-1" />}
              <div className={cn("flex flex-col gap-1 max-w-[88%]", msg.role === "user" ? "items-end" : "items-start")}>
                <div className={cn(
                  "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                  msg.role === "user"
                    ? "bg-gradient-to-br from-primary to-violet-600 text-white rounded-tr-sm shadow-[0_4px_16px_rgba(59,130,246,0.25)]"
                    : msg.error
                      ? "bg-red-950/40 border border-red-500/25 text-red-300 rounded-tl-sm"
                      : "bg-[#1a1f2e] border border-white/[0.06] text-slate-200 rounded-tl-sm",
                )}>
                  {msg.error
                    ? <span className="flex items-center gap-2"><AlertCircle className="w-3.5 h-3.5 shrink-0" />{msg.content}</span>
                    : <>
                        {renderMarkdown(msg.content)}
                        {msg.streaming && msg.content && (
                          <span className="inline-block w-0.5 h-3.5 bg-primary ml-0.5 animate-pulse align-middle" />
                        )}
                      </>
                  }
                </div>
                {msg.role === "ai" && !msg.error && (
                  <div className="flex items-center gap-1 px-1">
                    <span className="text-[10px] text-muted-foreground">
                      {msg.ts.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    <CopyBtn text={msg.content} />
                  </div>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>

        {thinking && (
          <div className="flex gap-2.5">
            <AvaAvatar size={26} className="shrink-0 mt-1" />
            <div className="rounded-2xl rounded-tl-sm bg-[#1a1f2e] border border-white/[0.06]">
              <TypingDots />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Input ── */}
      <div className="px-4 py-3 border-t border-white/[0.08] shrink-0 bg-[#0c0e1c]/70">
        <div className="flex items-end gap-2 rounded-xl border border-white/[0.09] bg-[#1a1f2e]/80 px-3 py-2 focus-within:border-primary/35 transition-colors">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => { setInput(e.target.value); adjustHeight(e.target); }}
            onKeyDown={handleKeyDown}
            placeholder="Escribe tu mensaje..."
            rows={1}
            className="flex-1 bg-transparent text-sm text-white placeholder:text-slate-500 outline-none resize-none leading-6 scrollbar-thin"
            style={{ height: "24px", minHeight: "24px", maxHeight: "128px" }}
          />
          <button
            onClick={() => void sendMessage(input)}
            disabled={!input.trim() || thinking}
            className="p-1.5 rounded-lg bg-primary/20 hover:bg-primary/30 disabled:opacity-30 disabled:cursor-not-allowed text-primary transition-all shrink-0"
          >
            <Send className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground/35 mt-1.5 text-center">
          Enter para enviar · Shift+Enter nueva línea
        </p>
      </div>
    </div>
  );
}
