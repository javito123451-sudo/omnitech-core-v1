import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Hexagon, Send, Plus, Search, Sparkles, Zap,
  FileText, Calendar, RefreshCw, BarChart2,
  ChevronLeft, Copy, Check, Trash2, AlertCircle,
  UserRound, X, Building2, ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useListClients } from "@workspace/api-client-react";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────
type Role = "user" | "ai";

type Msg = {
  id: string;
  role: Role;
  content: string;
  ts: Date;
  streaming?: boolean;
  error?: boolean;
};

type Session = {
  id: string;
  title: string;
  preview: string;
  ts: Date;
  msgs: Msg[];
};

interface ClientCtx {
  id: number;
  name: string;
  email: string;
  phone?: string | null;
  company?: string | null;
  status: string;
  tags?: string | null;
  notes?: string | null;
  value?: number | null;
}

// ── Constants ─────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUS_LABEL: Record<string, string> = {
  lead: "Prospecto", active: "Activo", inactive: "Inactivo", churned: "Perdido",
};
const STATUS_COLOR: Record<string, string> = {
  lead:     "bg-blue-500/15 text-blue-400 border-blue-500/25",
  active:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  inactive: "bg-slate-500/15 text-slate-400 border-slate-500/25",
  churned:  "bg-red-500/15 text-red-400 border-red-500/25",
};
const AVATAR_COLORS = [
  "bg-blue-600","bg-violet-600","bg-emerald-600",
  "bg-orange-500","bg-rose-500","bg-indigo-600","bg-teal-600",
];
const avatarColor = (name: string) => AVATAR_COLORS[name.charCodeAt(0) % AVATAR_COLORS.length];
const initials    = (name: string) => name.split(" ").slice(0,2).map(n=>n[0]).join("").toUpperCase();

// ── Dynamic suggestions based on client ──────────────────────────────────
function getSuggestions(client: ClientCtx | null) {
  if (client) {
    const first = client.name.split(" ")[0];
    const co    = client.company ?? first;
    return [
      { icon: <RefreshCw className="w-3.5 h-3.5"/>, label: "Redactar mensaje",   text: `Redacta un mensaje profesional de seguimiento para ${first} de ${co}. Lleva ${client.status === "lead" ? "varios días sin responder" : "tiempo sin contacto"}.` },
      { icon: <FileText   className="w-3.5 h-3.5"/>, label: "Crear presupuesto",  text: `Crea un presupuesto profesional para ${co}. Usa su nombre (${first}) y adapta la propuesta a su perfil.` },
      { icon: <Calendar   className="w-3.5 h-3.5"/>, label: "Proponer reunión",   text: `Ayúdame a proponer una reunión a ${first} de ${co}. Sugiere horarios y redacta el mensaje de invitación.` },
      { icon: <Zap        className="w-3.5 h-3.5"/>, label: "Plan de acción",     text: `Analiza la situación de ${first} (${co}) y dame un plan de acción concreto para avanzar en la venta.` },
      { icon: <BarChart2  className="w-3.5 h-3.5"/>, label: "Análisis de cliente",text: `Dame un análisis completo de ${first} de ${co} y recomiéndame la mejor estrategia para cerrar o fidelizar.` },
    ];
  }
  return [
    { icon: <RefreshCw className="w-3.5 h-3.5"/>, label: "Responder cliente",      text: "Ayúdame a redactar una respuesta profesional para un cliente que lleva 5 días sin noticias." },
    { icon: <FileText   className="w-3.5 h-3.5"/>, label: "Crear presupuesto",      text: "Crea un presupuesto profesional para un cliente de servicios SaaS por 12 meses." },
    { icon: <Calendar   className="w-3.5 h-3.5"/>, label: "Agendar cita",           text: "Ayúdame a proponer horarios para una reunión de demo con un nuevo prospecto." },
    { icon: <Zap        className="w-3.5 h-3.5"/>, label: "Seguimiento automático", text: "Diseña una secuencia de seguimiento de 3 pasos para prospectos que no han respondido." },
    { icon: <BarChart2  className="w-3.5 h-3.5"/>, label: "Resumen diario",         text: "Dame un resumen ejecutivo de lo que debería priorizar hoy en ventas." },
  ];
}

// ── Markdown renderer ────────────────────────────────────────────────────
function inlineFormat(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((p,i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i} className="text-white font-semibold">{p.slice(2,-2)}</strong>;
    if (p.startsWith("*")  && p.endsWith("*") && p.length>2) return <em key={i} className="text-slate-300 italic">{p.slice(1,-1)}</em>;
    return p;
  });
}
function renderMarkdown(text: string): React.ReactNode[] {
  return text.split("\n").map((line,i) => {
    if (line.startsWith("> "))   return <blockquote key={i} className="border-l-2 border-primary/60 pl-3 my-1 text-slate-300 italic">{inlineFormat(line.slice(2))}</blockquote>;
    if (/^\|/.test(line))        return <span key={i} className="block font-mono text-xs text-slate-300">{line}</span>;
    if (/^#{1,3} /.test(line))   return <strong key={i} className="block text-white font-bold mt-1 mb-0.5">{line.replace(/^#{1,3} /,"")}</strong>;
    if (/^[-*] /.test(line))     return <span key={i} className="flex gap-2"><span className="text-primary mt-0.5 shrink-0">•</span><span>{inlineFormat(line.slice(2))}</span></span>;
    return <span key={i} className="block leading-relaxed">{inlineFormat(line)}<br/></span>;
  });
}

// ── Typing dots ───────────────────────────────────────────────────────────
function TypingDots() {
  return (
    <div className="flex items-center gap-1 px-4 py-3">
      {[0,1,2].map(i=>(
        <motion.div key={i} className="w-2 h-2 rounded-full bg-primary"
          animate={{opacity:[0.3,1,0.3],scale:[0.8,1.1,0.8]}}
          transition={{repeat:Infinity,duration:1.2,delay:i*0.2}}/>
      ))}
    </div>
  );
}

// ── Copy button ───────────────────────────────────────────────────────────
function CopyBtn({ text }: { text: string }) {
  const [ok,setOk] = useState(false);
  return (
    <button onClick={()=>{navigator.clipboard.writeText(text);setOk(true);setTimeout(()=>setOk(false),1500)}}
      className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-white transition-all">
      {ok ? <Check className="w-3.5 h-3.5 text-green-400"/> : <Copy className="w-3.5 h-3.5"/>}
    </button>
  );
}

// ── AI Avatar ─────────────────────────────────────────────────────────────
function AiAvatar() {
  return (
    <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/30 to-violet-600/30 border border-primary/20 flex items-center justify-center shrink-0 mt-1">
      <Hexagon className="w-4 h-4 text-primary fill-primary/10"/>
    </div>
  );
}

// ── Message bubble ────────────────────────────────────────────────────────
function MessageBubble({ msg }: { msg: Msg }) {
  const isUser = msg.role === "user";
  return (
    <motion.div initial={{opacity:0,y:10}} animate={{opacity:1,y:0}} transition={{duration:0.2}}
      className={cn("flex gap-3 group", isUser ? "flex-row-reverse" : "flex-row")}>
      {!isUser && <AiAvatar/>}
      <div className={cn("flex flex-col gap-1 max-w-[85%] md:max-w-[72%]", isUser?"items-end":"items-start")}>
        <div className={cn("rounded-2xl px-4 py-3 text-sm leading-relaxed shadow-lg",
          isUser
            ? "bg-gradient-to-br from-primary to-violet-600 text-white rounded-tr-sm shadow-[0_4px_20px_rgba(59,130,246,0.25)]"
            : msg.error
              ? "bg-red-950/40 border border-red-500/30 text-red-300 rounded-tl-sm"
              : "bg-[#1a1f2e] border border-white/[0.06] text-slate-200 rounded-tl-sm"
        )}>
          {msg.error
            ? <span className="flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0"/>{msg.content}</span>
            : <span className="whitespace-pre-wrap">
                {renderMarkdown(msg.content)}
                {msg.streaming && msg.content && <span className="inline-block w-0.5 h-4 bg-primary ml-0.5 animate-pulse align-middle"/>}
              </span>
          }
        </div>
        <div className={cn("flex items-center gap-1.5 px-1", isUser?"flex-row-reverse":"flex-row")}>
          <span className="text-[10px] text-muted-foreground">
            {msg.ts.toLocaleTimeString("es-ES",{hour:"2-digit",minute:"2-digit"})}
          </span>
          {!isUser && !msg.error && <CopyBtn text={msg.content}/>}
        </div>
      </div>
    </motion.div>
  );
}

// ── Client Picker ─────────────────────────────────────────────────────────
function ClientPicker({
  selected, onSelect, onClose,
}: {
  selected: ClientCtx | null;
  onSelect: (c: ClientCtx | null) => void;
  onClose: () => void;
}) {
  const { data: clients } = useListClients();
  const [q, setQ] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const filtered = clients?.filter(c =>
    !q || c.name.toLowerCase().includes(q.toLowerCase()) ||
    (c.company ?? "").toLowerCase().includes(q.toLowerCase())
  ) ?? [];

  return (
    <motion.div
      initial={{opacity:0,y:8,scale:0.97}}
      animate={{opacity:1,y:0,scale:1}}
      exit={{opacity:0,y:8,scale:0.97}}
      transition={{duration:0.15}}
      className="absolute bottom-full left-0 right-0 mb-2 z-50 bg-[#141824] border border-white/[0.1] rounded-2xl shadow-[0_-8px_40px_rgba(0,0,0,0.5)] overflow-hidden"
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.06]">
        <span className="text-sm font-semibold text-white flex items-center gap-2">
          <UserRound className="w-4 h-4 text-primary"/> Seleccionar cliente
        </span>
        <button onClick={onClose} className="p-1 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">
          <X className="w-4 h-4"/>
        </button>
      </div>

      {/* Search */}
      <div className="px-3 py-2 border-b border-white/[0.06]">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"/>
          <Input ref={inputRef} value={q} onChange={e=>setQ(e.target.value)}
            placeholder="Buscar cliente o empresa..."
            className="pl-8 h-8 bg-background/40 border-white/[0.07] text-sm"/>
        </div>
      </div>

      {/* Clear selection */}
      {selected && (
        <button onClick={()=>{onSelect(null);onClose();}}
          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-colors border-b border-white/[0.06] text-left">
          <div className="w-7 h-7 rounded-lg bg-border/50 flex items-center justify-center shrink-0">
            <X className="w-3.5 h-3.5 text-muted-foreground"/>
          </div>
          <span className="text-sm text-muted-foreground">Sin contexto de cliente</span>
        </button>
      )}

      {/* List */}
      <div className="max-h-56 overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">Sin resultados</div>
        ) : filtered.map(c => (
          <button key={c.id} onClick={()=>{onSelect(c as ClientCtx);onClose();}}
            className={cn(
              "w-full flex items-center gap-3 px-4 py-2.5 hover:bg-white/5 transition-all text-left",
              selected?.id === c.id && "bg-primary/10"
            )}>
            <div className={cn("w-7 h-7 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0", avatarColor(c.name))}>
              {initials(c.name)}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm text-white font-medium truncate">{c.name}</span>
                <Badge variant="outline" className={cn("text-[9px] px-1.5 py-0 h-4 shrink-0 font-semibold", STATUS_COLOR[c.status])}>
                  {STATUS_LABEL[c.status]}
                </Badge>
              </div>
              {c.company && (
                <span className="text-[11px] text-muted-foreground flex items-center gap-1 mt-0.5">
                  <Building2 className="w-2.5 h-2.5 shrink-0"/> {c.company}
                </span>
              )}
            </div>
            {c.value ? <span className="text-xs text-emerald-400 font-semibold shrink-0">€{(c.value/1000).toFixed(0)}k</span> : null}
            {selected?.id === c.id && <Check className="w-3.5 h-3.5 text-primary shrink-0"/>}
          </button>
        ))}
      </div>
    </motion.div>
  );
}

// ── Welcome screen ────────────────────────────────────────────────────────
function WelcomeScreen({ onSuggest }: { onSuggest: (text:string)=>void }) {
  const suggestions = getSuggestions(null);
  return (
    <motion.div initial={{opacity:0,y:20}} animate={{opacity:1,y:0}}
      className="flex flex-col items-center justify-center h-full px-4 gap-8 text-center">
      <div className="relative">
        <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-primary/30 via-violet-600/20 to-indigo-600/10 border border-primary/30 flex items-center justify-center shadow-[0_0_40px_rgba(59,130,246,0.2)]">
          <Hexagon className="w-10 h-10 text-primary fill-primary/15"/>
        </div>
        <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-emerald-400 border-2 border-background animate-pulse"/>
      </div>
      <div className="space-y-2">
        <h2 className="text-2xl md:text-3xl font-bold text-white">Omniflow <span className="text-primary">AI</span></h2>
        <p className="text-muted-foreground text-sm md:text-base max-w-xs">
          Tu asistente de negocios inteligente. Selecciona un cliente para respuestas personalizadas.
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2 w-full max-w-2xl">
        {suggestions.map(s=>(
          <button key={s.label} onClick={()=>onSuggest(s.text)}
            className="p-3.5 rounded-xl bg-card border border-white/[0.07] hover:border-primary/40 hover:bg-primary/5 text-left transition-all group shadow-sm">
            <div className="flex items-center gap-2 mb-1.5">
              <div className="text-primary group-hover:scale-110 transition-transform">{s.icon}</div>
              <span className="text-white text-sm font-medium">{s.label}</span>
            </div>
            <p className="text-xs text-muted-foreground line-clamp-2">{s.text}</p>
          </button>
        ))}
      </div>
    </motion.div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────
export default function Assistant() {
  const [sessions, setSessions]       = useState<Session[]>([]);
  const [activeId, setActiveId]       = useState<string | null>(null);
  const [showList, setShowList]       = useState(false);
  const [input, setInput]             = useState("");
  const [isThinking, setIsThinking]   = useState(false);
  const [search, setSearch]           = useState("");
  const [contextClient, setContextClient] = useState<ClientCtx | null>(null);
  const [showPicker, setShowPicker]   = useState(false);
  const bottomRef  = useRef<HTMLDivElement>(null);
  const abortRef   = useRef<AbortController | null>(null);
  const inputAreaRef = useRef<HTMLDivElement>(null);

  const activeSession = sessions.find(s=>s.id===activeId) ?? null;
  const suggestions   = getSuggestions(contextClient);

  const scrollToBottom = () =>
    setTimeout(()=>bottomRef.current?.scrollIntoView({behavior:"smooth"}),50);

  // Close picker when clicking outside
  useEffect(()=>{
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (inputAreaRef.current && !inputAreaRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return ()=>document.removeEventListener("mousedown", handler);
  }, [showPicker]);

  const sendMessage = useCallback(async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || isThinking) return;
    setInput("");
    setShowPicker(false);

    const now    = new Date();
    const userMsg: Msg = {id:crypto.randomUUID(),role:"user",content:trimmed,ts:now};

    let targetId  = activeId;
    let history: {role:"user"|"assistant";content:string}[] = [];

    if (!targetId) {
      const newSession: Session = {
        id: crypto.randomUUID(),
        title: trimmed.slice(0,45),
        preview: trimmed.slice(0,70),
        ts: now, msgs: [userMsg],
      };
      setSessions(prev=>[newSession,...prev]);
      setActiveId(newSession.id);
      setShowList(false);
      targetId = newSession.id;
      history  = [{role:"user",content:trimmed}];
    } else {
      const existing = sessions.find(s=>s.id===targetId);
      history = [
        ...(existing?.msgs??[]).map(m=>({
          role:(m.role==="user"?"user":"assistant") as "user"|"assistant",
          content: m.content,
        })),
        {role:"user" as const,content:trimmed},
      ];
      setSessions(prev=>prev.map(s=>s.id===targetId
        ? {...s,msgs:[...s.msgs,userMsg],preview:trimmed.slice(0,70),ts:now} : s));
    }

    scrollToBottom();
    setIsThinking(true);
    await new Promise(r=>setTimeout(r,700));

    const aiId  = crypto.randomUUID();
    const aiMsg: Msg = {id:aiId,role:"ai",content:"",ts:new Date(),streaming:true};
    setSessions(prev=>prev.map(s=>s.id===targetId?{...s,msgs:[...s.msgs,aiMsg]}:s));
    setIsThinking(false);
    scrollToBottom();

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const res = await fetch(`${API_BASE}/api/chat`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          messages: history,
          clientContext: contextClient ?? undefined,
        }),
        signal: ctrl.signal,
      });

      if (!res.ok) {
        const err = await res.json().catch(()=>({error:"Error de conexión"}));
        setSessions(prev=>prev.map(s=>s.id===targetId
          ? {...s,msgs:s.msgs.map(m=>m.id===aiId?{...m,content:err.error??"Error inesperado",streaming:false,error:true}:m)}:s));
        return;
      }

      const reader  = res.body!.getReader();
      const decoder = new TextDecoder();
      let   acc     = "";

      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        for (const line of decoder.decode(value,{stream:true}).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          const payload = line.slice(6).trim();
          if (payload==="[DONE]") break;
          try {
            const parsed = JSON.parse(payload) as {token?:string;error?:string};
            if (parsed.error) throw new Error(parsed.error);
            if (parsed.token) {
              acc += parsed.token;
              const snap = acc;
              setSessions(prev=>prev.map(s=>s.id===targetId
                ?{...s,msgs:s.msgs.map(m=>m.id===aiId?{...m,content:snap}:m)}:s));
              scrollToBottom();
            }
          } catch { /* partial chunk */ }
        }
      }

      setSessions(prev=>prev.map(s=>s.id===targetId
        ?{...s,preview:acc.slice(0,70),msgs:s.msgs.map(m=>m.id===aiId?{...m,streaming:false}:m)}:s));
    } catch(err) {
      if ((err as Error).name==="AbortError") return;
      setSessions(prev=>prev.map(s=>s.id===targetId
        ?{...s,msgs:s.msgs.map(m=>m.id===aiId
          ?{...m,content:"No se pudo conectar con Omniflow AI. Verifica tu API key.",streaming:false,error:true}:m)}:s));
    }
  }, [activeId,isThinking,sessions,contextClient]);

  const startNewChat = () => {
    abortRef.current?.abort();
    setActiveId(null);
    setShowList(false);
    setInput("");
  };

  const deleteSession = (id:string) => {
    setSessions(prev=>prev.filter(s=>s.id!==id));
    if (activeId===id) { setActiveId(null); setShowList(true); }
  };

  const filteredSessions = sessions.filter(s=>
    !search||s.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="h-[calc(100dvh-7rem)] md:h-[calc(100dvh-3rem)] flex gap-0 md:gap-4 animate-in fade-in duration-300">

      {/* ── Sidebar ── */}
      <div className={cn(
        "flex-col bg-card border border-border rounded-xl overflow-hidden",
        "w-full md:w-64 md:flex md:shrink-0",
        showList?"flex":"hidden md:flex"
      )}>
        <div className="p-3 border-b border-border space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Hexagon className="w-4 h-4 text-primary fill-primary/15"/>
              <span className="text-sm font-bold text-white">Conversaciones</span>
            </div>
            <button onClick={startNewChat}
              className="p-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary transition-colors">
              <Plus className="w-4 h-4"/>
            </button>
          </div>
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground"/>
            <Input value={search} onChange={e=>setSearch(e.target.value)}
              placeholder="Buscar..." className="pl-8 h-8 bg-background/50 border-border text-xs"/>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-0.5">
          {filteredSessions.length===0
            ? <div className="flex flex-col items-center justify-center h-32 text-muted-foreground gap-2">
                <Sparkles className="w-6 h-6 opacity-20"/>
                <p className="text-xs">Sin conversaciones aún</p>
              </div>
            : filteredSessions.map(s=>(
              <div key={s.id} onClick={()=>{setActiveId(s.id);setShowList(false);}}
                className={cn("p-2.5 rounded-lg cursor-pointer group flex items-start gap-2 transition-all",
                  activeId===s.id?"bg-primary/15 border border-primary/25":"hover:bg-white/5 border border-transparent")}>
                <div className="flex-1 min-w-0">
                  <p className={cn("text-xs font-medium truncate",activeId===s.id?"text-white":"text-slate-300")}>{s.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate mt-0.5">{s.preview}</p>
                </div>
                <button onClick={e=>{e.stopPropagation();deleteSession(s.id);}}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-muted-foreground hover:text-red-400 transition-all shrink-0">
                  <Trash2 className="w-3 h-3"/>
                </button>
              </div>
            ))
          }
        </div>

        <div className="p-3 border-t border-border shrink-0">
          <div className="flex items-center gap-2 p-2 rounded-lg bg-primary/5 border border-primary/10">
            <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"/>
            <span className="text-xs text-muted-foreground">Omniflow AI <span className="text-primary font-medium">GPT-4o mini</span></span>
          </div>
        </div>
      </div>

      {/* ── Chat area ── */}
      <div className={cn(
        "flex-1 flex flex-col bg-card border border-border rounded-xl overflow-hidden min-w-0",
        showList?"hidden md:flex":"flex"
      )}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border shrink-0 bg-background/30">
          <button onClick={()=>setShowList(true)}
            className="md:hidden p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">
            <ChevronLeft className="w-4 h-4"/>
          </button>

          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary/25 to-violet-600/25 border border-primary/20 flex items-center justify-center shrink-0">
            <Hexagon className="w-4 h-4 text-primary fill-primary/10"/>
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-bold text-white truncate">
              {activeSession ? activeSession.title : "Omniflow AI"}
            </p>
            <div className="flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"/>
              <span className="text-[10px] text-emerald-400 font-medium">
                {isThinking ? "Procesando…" : "Conectado · GPT-4o mini"}
              </span>
            </div>
          </div>

          {/* Context client badge in header */}
          {contextClient && (
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/10 border border-primary/20 shrink-0">
              <div className={cn("w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold text-white", avatarColor(contextClient.name))}>
                {initials(contextClient.name)[0]}
              </div>
              <span className="text-xs text-primary font-medium truncate max-w-[80px]">{contextClient.name.split(" ")[0]}</span>
            </div>
          )}

          {activeSession && (
            <button onClick={startNewChat}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">
              <Plus className="w-4 h-4"/>
            </button>
          )}
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
          {!activeSession
            ? <WelcomeScreen onSuggest={text=>{setShowList(false);sendMessage(text);}}/>
            : <>
                {activeSession.msgs.map(msg=><MessageBubble key={msg.id} msg={msg}/>)}
                <AnimatePresence>
                  {isThinking && (
                    <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} exit={{opacity:0}}
                      className="flex items-start gap-3">
                      <AiAvatar/>
                      <div className="bg-[#1a1f2e] border border-white/[0.06] rounded-2xl rounded-tl-sm"><TypingDots/></div>
                    </motion.div>
                  )}
                </AnimatePresence>
                <div ref={bottomRef}/>
              </>
          }
        </div>

        {/* Quick suggestions */}
        {activeSession && !isThinking && (
          <div className="px-4 pb-2 shrink-0">
            <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
              {suggestions.map(s=>(
                <button key={s.label} onClick={()=>sendMessage(s.text)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/60 border border-white/[0.08] hover:border-primary/40 hover:bg-primary/5 text-xs text-muted-foreground hover:text-primary transition-all whitespace-nowrap shrink-0">
                  {s.icon} {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input area */}
        <div className="p-3 pt-0 shrink-0" ref={inputAreaRef}>

          {/* Client context chip */}
          <AnimatePresence>
            {contextClient && (
              <motion.div initial={{opacity:0,height:0}} animate={{opacity:1,height:"auto"}} exit={{opacity:0,height:0}}
                className="mb-2 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-primary/8 border border-primary/20">
                  <div className={cn("w-6 h-6 rounded-md flex items-center justify-center text-white text-[10px] font-bold shrink-0", avatarColor(contextClient.name))}>
                    {initials(contextClient.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-white truncate">{contextClient.name}</p>
                    {contextClient.company && (
                      <p className="text-[10px] text-muted-foreground truncate">{contextClient.company}</p>
                    )}
                  </div>
                  <Badge variant="outline" className={cn("text-[9px] px-1.5 h-4 shrink-0", STATUS_COLOR[contextClient.status])}>
                    {STATUS_LABEL[contextClient.status]}
                  </Badge>
                  {contextClient.value ? (
                    <span className="text-[10px] text-emerald-400 font-semibold shrink-0">
                      €{(contextClient.value/1000).toFixed(0)}k
                    </span>
                  ) : null}
                  <button onClick={()=>setContextClient(null)}
                    className="p-0.5 rounded text-muted-foreground hover:text-white transition-colors shrink-0">
                    <X className="w-3.5 h-3.5"/>
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Client picker popover */}
          <div className="relative">
            <AnimatePresence>
              {showPicker && (
                <ClientPicker
                  selected={contextClient}
                  onSelect={setContextClient}
                  onClose={()=>setShowPicker(false)}
                />
              )}
            </AnimatePresence>

            {/* Input bar */}
            <form onSubmit={e=>{e.preventDefault();sendMessage(input);}}
              className="flex items-end gap-2 p-2 rounded-2xl bg-[#141824] border border-white/[0.08] focus-within:border-primary/40 transition-colors shadow-[0_4px_20px_rgba(0,0,0,0.3)]">

              {/* Client picker trigger */}
              <button type="button" onClick={()=>setShowPicker(v=>!v)}
                className={cn(
                  "flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-all shrink-0 self-end mb-0.5",
                  contextClient
                    ? "bg-primary/15 text-primary border border-primary/30 hover:bg-primary/25"
                    : showPicker
                      ? "bg-primary/15 text-primary border border-primary/30"
                      : "bg-white/5 text-muted-foreground border border-white/[0.07] hover:border-primary/30 hover:text-primary"
                )}>
                <UserRound className="w-3.5 h-3.5 shrink-0"/>
                <span className="hidden sm:inline">
                  {contextClient ? contextClient.name.split(" ")[0] : "Cliente"}
                </span>
                <ChevronDown className={cn("w-3 h-3 transition-transform", showPicker && "rotate-180")}/>
              </button>

              <textarea value={input} onChange={e=>setInput(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();sendMessage(input);}}}
                placeholder={contextClient
                  ? `Pregunta sobre ${contextClient.name.split(" ")[0]}…`
                  : "Escribe un mensaje… (Enter para enviar)"
                }
                rows={1} disabled={isThinking}
                className="flex-1 bg-transparent text-white text-sm placeholder:text-muted-foreground/50 resize-none focus:outline-none min-h-[36px] max-h-[120px] py-1.5 px-2 leading-relaxed disabled:opacity-50"/>

              <button type="submit" disabled={!input.trim()||isThinking}
                className={cn(
                  "w-9 h-9 rounded-xl flex items-center justify-center shrink-0 transition-all duration-200",
                  input.trim()&&!isThinking
                    ? "bg-gradient-to-br from-primary to-violet-600 text-white shadow-[0_4px_15px_rgba(59,130,246,0.35)] hover:shadow-[0_4px_20px_rgba(59,130,246,0.5)] hover:scale-105"
                    : "bg-white/5 text-muted-foreground cursor-not-allowed"
                )}>
                <Send className="w-4 h-4"/>
              </button>
            </form>
          </div>

          <p className="text-center text-[10px] text-muted-foreground/40 mt-1.5">
            GPT-4o mini · Omniflow AI puede cometer errores. Verifica información importante.
          </p>
        </div>
      </div>
    </div>
  );
}
