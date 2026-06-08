import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";
import {
  Brain, BookOpen, GitBranch, UserRound, Zap, Building2,
  TrendingUp, Info, FileText, Tag, Search, Plus, Pencil,
  Trash2, X, Clock, Sparkles, Loader2, History, ChevronDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// ── Types ─────────────────────────────────────────────────────────────────────
type MemoryEntry = {
  id: number; orgId: number; agentSlug: string;
  memoryKey: string; memoryVal: string;
  title: string | null; category: string | null;
  tags: string | null; source: string | null;
  createdAt: string | null; updatedAt: string;
  _score?: number;
};

type HistoryEntry = {
  id: number; action: string;
  prevVal: string | null; newVal: string | null;
  prevTitle: string | null; newTitle: string | null;
  source: string | null; changedAt: string;
};

// ── Constants ─────────────────────────────────────────────────────────────────
const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const ALL_CATEGORIES = [
  { id: "all",        label: "Todos",        icon: Brain,       cls: "text-slate-300 bg-white/5 border-white/10" },
  { id: "sop",        label: "SOPs",          icon: BookOpen,    cls: "text-violet-400 bg-violet-400/10 border-violet-400/25" },
  { id: "process",    label: "Procesos",      icon: GitBranch,   cls: "text-cyan-400 bg-cyan-400/10 border-cyan-400/25" },
  { id: "client",     label: "Clientes",      icon: UserRound,   cls: "text-blue-400 bg-blue-400/10 border-blue-400/25" },
  { id: "decision",   label: "Decisiones",    icon: Zap,         cls: "text-amber-400 bg-amber-400/10 border-amber-400/25" },
  { id: "context",    label: "Contexto",      icon: Building2,   cls: "text-emerald-400 bg-emerald-400/10 border-emerald-400/25" },
  { id: "goal",       label: "Objetivos",     icon: TrendingUp,  cls: "text-rose-400 bg-rose-400/10 border-rose-400/25" },
  { id: "info",       label: "Información",   icon: Info,        cls: "text-sky-400 bg-sky-400/10 border-sky-400/25" },
  { id: "fact",       label: "Hechos",        icon: FileText,    cls: "text-green-400 bg-green-400/10 border-green-400/25" },
  { id: "preference", label: "Preferencias",  icon: Tag,         cls: "text-pink-400 bg-pink-400/10 border-pink-400/25" },
];

const CAT_MAP = Object.fromEntries(ALL_CATEGORIES.map(c => [c.id, c]));

function resolveCategory(mem: MemoryEntry): string {
  if (mem.category) return mem.category;
  const i = mem.memoryKey.indexOf(":");
  return i !== -1 ? mem.memoryKey.slice(0, i) : "info";
}

function resolveTitle(mem: MemoryEntry): string {
  if (mem.title) return mem.title;
  const i = mem.memoryKey.indexOf(":");
  const name = i !== -1 ? mem.memoryKey.slice(i + 1) : mem.memoryKey;
  return name.replace(/_/g, " ");
}

// ── CategoryBadge ─────────────────────────────────────────────────────────────
function CategoryBadge({ category, size = "sm" }: { category: string; size?: "xs" | "sm" }) {
  const meta = CAT_MAP[category] ?? CAT_MAP["info"]!;
  const Icon = meta.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 rounded border font-medium",
      size === "xs" ? "px-1.5 py-0.5 text-[10px]" : "px-2 py-1 text-xs",
      meta.cls,
    )}>
      <Icon className={size === "xs" ? "w-2.5 h-2.5" : "w-3 h-3"} />
      {meta.label}
    </span>
  );
}

// ── MemoryCard ────────────────────────────────────────────────────────────────
function MemoryCard({
  mem, onEdit, onDelete, onHistory,
}: {
  mem: MemoryEntry;
  onEdit: (m: MemoryEntry) => void;
  onDelete: (id: number) => void;
  onHistory: (m: MemoryEntry) => void;
}) {
  const cat   = resolveCategory(mem);
  const title = resolveTitle(mem);
  const tags  = mem.tags ? mem.tags.split(",").map(t => t.trim()).filter(Boolean) : [];

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      className="group bg-card border border-white/[0.07] rounded-xl p-4 flex flex-col gap-3 hover:border-white/[0.14] transition-colors"
    >
      <div className="flex items-start gap-2">
        <CategoryBadge category={cat} />
        {mem._score !== undefined && (
          <span className="ml-auto text-[10px] text-primary/70 font-mono shrink-0">
            {Math.round(mem._score * 100)}%
          </span>
        )}
      </div>

      <div className="flex-1 min-h-0">
        <h3 className="text-sm font-semibold text-white capitalize leading-snug mb-1.5">
          {title}
        </h3>
        <p className="text-xs text-muted-foreground leading-relaxed line-clamp-4">
          {mem.memoryVal}
        </p>
      </div>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map(t => (
            <span key={t} className="text-[10px] text-muted-foreground bg-white/[0.04] border border-white/[0.06] rounded px-1.5 py-0.5">
              #{t}
            </span>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between border-t border-white/[0.05] pt-2.5 mt-auto">
        <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {mem.source === "ai" ? (
            <><Sparkles className="w-3 h-3 text-primary/60" />IA</>
          ) : (
            <><Clock className="w-3 h-3" />Manual</>
          )}
          <span>·</span>
          <span>{formatDistanceToNow(new Date(mem.updatedAt), { locale: es, addSuffix: true })}</span>
        </div>
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onClick={() => onHistory(mem)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
            title="Ver historial">
            <History className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onEdit(mem)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
            title="Editar">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => onDelete(mem.id)}
            className="p-1.5 rounded-md text-muted-foreground hover:text-red-400 hover:bg-red-400/5 transition-colors"
            title="Eliminar">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── MemoryModal (create + edit) ───────────────────────────────────────────────
function MemoryModal({
  mem,
  onClose,
  onSaved,
}: {
  mem: MemoryEntry | null;
  onClose: () => void;
  onSaved: (saved: MemoryEntry) => void;
}) {
  const isEdit = !!mem;

  const [title,    setTitle]    = useState(mem ? resolveTitle(mem) : "");
  const [value,    setValue]    = useState(mem?.memoryVal ?? "");
  const [category, setCategory] = useState(mem ? resolveCategory(mem) : "info");
  const [tags,     setTags]     = useState(mem?.tags ?? "");
  const [saving,   setSaving]   = useState(false);
  const [error,    setError]    = useState("");
  const [catOpen,  setCatOpen]  = useState(false);

  const catMeta = CAT_MAP[category] ?? CAT_MAP["info"]!;
  const CatIcon = catMeta.icon;

  const handleSave = async () => {
    if (!value.trim()) { setError("El contenido es requerido."); return; }
    setSaving(true); setError("");
    try {
      const body = { value: value.trim(), title: title.trim() || undefined, category, tags: tags.trim() || undefined };
      let res: Response;
      if (isEdit) {
        res = await fetch(`${API_BASE}/api/memory/${mem.id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
      } else {
        res = await fetch(`${API_BASE}/api/memory`, {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
        });
      }
      if (!res.ok) { setError("Error al guardar."); return; }
      const saved = await res.json() as MemoryEntry;
      onSaved(saved);
      onClose();
    } catch {
      setError("Error de conexión.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-lg bg-card border border-white/[0.1] rounded-2xl shadow-2xl flex flex-col"
      >
        <div className="flex items-center gap-3 px-5 py-4 border-b border-border">
          <div className="w-8 h-8 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Brain className="w-4 h-4 text-primary" />
          </div>
          <h2 className="text-sm font-semibold text-white flex-1">
            {isEdit ? "Editar recuerdo" : "Nuevo recuerdo"}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Category selector */}
          <div className="relative">
            <label className="text-xs text-muted-foreground mb-1.5 block">Categoría</label>
            <button
              onClick={() => setCatOpen(v => !v)}
              className="w-full flex items-center gap-2 px-3 py-2 bg-background/50 border border-border rounded-lg text-sm hover:border-white/20 transition-colors"
            >
              <span className={cn("flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded border", catMeta.cls)}>
                <CatIcon className="w-3 h-3" />
                {catMeta.label}
              </span>
              <ChevronDown className="w-4 h-4 text-muted-foreground ml-auto" />
            </button>
            <AnimatePresence>
              {catOpen && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="absolute z-10 top-full mt-1 w-full bg-card border border-border rounded-xl shadow-xl p-1 grid grid-cols-2 gap-0.5"
                >
                  {ALL_CATEGORIES.filter(c => c.id !== "all").map(c => {
                    const Icon = c.icon;
                    return (
                      <button key={c.id} onClick={() => { setCategory(c.id); setCatOpen(false); }}
                        className={cn(
                          "flex items-center gap-2 px-2.5 py-2 rounded-lg text-xs transition-colors",
                          category === c.id ? "bg-primary/10 text-primary" : "hover:bg-white/5 text-muted-foreground hover:text-white",
                        )}>
                        <Icon className="w-3.5 h-3.5" />
                        {c.label}
                      </button>
                    );
                  })}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Title */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Título</label>
            <Input value={title} onChange={e => setTitle(e.target.value)}
              placeholder="Nombre descriptivo del recuerdo"
              className="bg-background/50 border-border" />
          </div>

          {/* Content */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">Contenido <span className="text-red-400">*</span></label>
            <textarea
              value={value}
              onChange={e => setValue(e.target.value)}
              placeholder="Escribe aquí el contenido del recuerdo..."
              rows={5}
              className="w-full text-sm bg-background/50 border border-border rounded-lg px-3 py-2.5 text-white placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-1 focus:ring-primary/50"
            />
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs text-muted-foreground mb-1.5 block">
              Etiquetas <span className="text-[10px]">(separadas por coma)</span>
            </label>
            <Input value={tags} onChange={e => setTags(e.target.value)}
              placeholder="ventas, onboarding, cliente-vip"
              className="bg-background/50 border-border" />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}
        </div>

        <div className="flex gap-2 px-5 pb-5">
          <button onClick={onClose}
            className="flex-1 h-9 rounded-lg border border-border text-sm text-muted-foreground hover:text-white hover:border-white/20 transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving || !value.trim()}
            className="flex-1 h-9 rounded-lg bg-primary text-white text-sm font-medium disabled:opacity-50 hover:bg-primary/90 transition-colors flex items-center justify-center gap-2">
            {saving ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />Guardando…</> : isEdit ? "Actualizar" : "Crear recuerdo"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ── HistoryDrawer ─────────────────────────────────────────────────────────────
function HistoryDrawer({
  mem,
  onClose,
}: {
  mem: MemoryEntry;
  onClose: () => void;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/api/memory/${mem.id}/history`)
      .then(r => r.json())
      .then(data => { setEntries(data as HistoryEntry[]); setLoading(false); })
      .catch(() => setLoading(false));
  }, [mem.id]);

  const ACTION_META: Record<string, { label: string; cls: string }> = {
    create: { label: "Creado",       cls: "text-emerald-400 bg-emerald-400/10" },
    update: { label: "Actualizado",  cls: "text-blue-400 bg-blue-400/10" },
    delete: { label: "Eliminado",    cls: "text-red-400 bg-red-400/10" },
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <motion.aside
        initial={{ x: "100%" }}
        animate={{ x: 0 }}
        exit={{ x: "100%" }}
        transition={{ type: "spring", damping: 28, stiffness: 240 }}
        className="w-80 max-w-full bg-card border-l border-border flex flex-col"
      >
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-border shrink-0">
          <History className="w-4 h-4 text-primary" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold text-white truncate capitalize">{resolveTitle(mem)}</p>
            <p className="text-[10px] text-muted-foreground">Historial de cambios</p>
          </div>
          <button onClick={onClose} className="p-1 rounded text-muted-foreground hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-2">
          {loading ? (
            <div className="flex items-center justify-center h-20 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-28 text-muted-foreground text-center">
              <History className="w-7 h-7 opacity-20 mb-2" />
              <p className="text-xs">Sin historial registrado</p>
            </div>
          ) : entries.map((e) => {
            const meta = ACTION_META[e.action] ?? { label: e.action, cls: "text-slate-400 bg-white/5" };
            return (
              <div key={e.id} className="bg-background/40 border border-white/[0.06] rounded-lg p-3 space-y-2">
                <div className="flex items-center gap-2">
                  <span className={cn("text-[10px] font-medium px-1.5 py-0.5 rounded", meta.cls)}>
                    {meta.label}
                  </span>
                  {e.source === "ai" && (
                    <span className="text-[10px] text-primary/70 flex items-center gap-0.5">
                      <Sparkles className="w-2.5 h-2.5" />IA
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground">
                    {formatDistanceToNow(new Date(e.changedAt), { locale: es, addSuffix: true })}
                  </span>
                </div>
                {e.action === "update" && e.prevVal && e.newVal && e.prevVal !== e.newVal && (
                  <div className="space-y-1.5">
                    <div className="bg-red-400/5 border border-red-400/15 rounded p-2">
                      <p className="text-[10px] text-red-400 font-medium mb-0.5">Anterior</p>
                      <p className="text-[11px] text-red-300/80 line-clamp-3">{e.prevVal}</p>
                    </div>
                    <div className="bg-emerald-400/5 border border-emerald-400/15 rounded p-2">
                      <p className="text-[10px] text-emerald-400 font-medium mb-0.5">Nuevo</p>
                      <p className="text-[11px] text-emerald-300/80 line-clamp-3">{e.newVal}</p>
                    </div>
                  </div>
                )}
                {e.action === "create" && e.newVal && (
                  <p className="text-[11px] text-muted-foreground line-clamp-3">{e.newVal}</p>
                )}
                {e.action === "delete" && e.prevVal && (
                  <p className="text-[11px] text-muted-foreground line-clamp-3 line-through opacity-60">{e.prevVal}</p>
                )}
              </div>
            );
          })}
        </div>
      </motion.aside>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function MemoryPage() {
  const [memories,      setMemories]      = useState<MemoryEntry[]>([]);
  const [loading,       setLoading]       = useState(true);
  const [searchQuery,   setSearchQuery]   = useState("");
  const [searching,     setSearching]     = useState(false);
  const [searchResults, setSearchResults] = useState<MemoryEntry[] | null>(null);
  const [selectedCat,   setSelectedCat]   = useState("all");
  const [modalMem,      setModalMem]      = useState<MemoryEntry | null | "new">(null);
  const [historyMem,    setHistoryMem]    = useState<MemoryEntry | null>(null);

  const searchTimer = useRef<ReturnType<typeof setTimeout>>();

  const fetchMemories = useCallback(async (category?: string) => {
    setLoading(true);
    try {
      const url = category && category !== "all"
        ? `${API_BASE}/api/memory?category=${category}`
        : `${API_BASE}/api/memory`;
      const res = await fetch(url);
      if (res.ok) setMemories(await res.json() as MemoryEntry[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMemories(selectedCat); }, [selectedCat, fetchMemories]);

  // Debounced semantic search
  useEffect(() => {
    clearTimeout(searchTimer.current);
    if (!searchQuery.trim()) { setSearchResults(null); return; }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`${API_BASE}/api/memory/search?q=${encodeURIComponent(searchQuery)}`);
        if (res.ok) setSearchResults(await res.json() as MemoryEntry[]);
      } finally {
        setSearching(false);
      }
    }, 400);
  }, [searchQuery]);

  const handleSaved = (saved: MemoryEntry) => {
    setMemories(prev => {
      const idx = prev.findIndex(m => m.id === saved.id);
      if (idx >= 0) return prev.map(m => m.id === saved.id ? saved : m);
      return [saved, ...prev];
    });
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar este recuerdo?")) return;
    await fetch(`${API_BASE}/api/memory/${id}`, { method: "DELETE" });
    setMemories(prev => prev.filter(m => m.id !== id));
    if (searchResults) setSearchResults(prev => prev?.filter(m => m.id !== id) ?? null);
  };

  const displayed = searchResults ?? memories;

  // Count per category
  const catCounts = memories.reduce<Record<string, number>>((acc, m) => {
    const cat = m.category ?? (m.memoryKey.includes(":") ? m.memoryKey.split(":")[0]! : "info");
    acc[cat] = (acc[cat] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="flex flex-col h-full overflow-hidden bg-background">

      {/* ── Header ── */}
      <div className="px-6 pt-6 pb-4 border-b border-border shrink-0 space-y-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
            <Brain className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-bold text-white">Memoria Organizacional</h1>
            <p className="text-xs text-muted-foreground">
              {memories.length} recuerdos · búsqueda semántica con IA
            </p>
          </div>
          <button
            onClick={() => setModalMem("new")}
            className="ml-auto flex items-center gap-2 px-3.5 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:bg-primary/90 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Nuevo recuerdo
          </button>
        </div>

        {/* Search */}
        <div className="relative">
          {searching
            ? <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary animate-spin" />
            : <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />}
          <Input
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            placeholder="Buscar en la memoria… (semántico)"
            className="pl-9 bg-card border-border"
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded text-muted-foreground hover:text-white transition-colors">
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {/* Category pills */}
        <div className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none">
          {ALL_CATEGORIES.map(cat => {
            const Icon  = cat.icon;
            const count = cat.id === "all" ? memories.length : (catCounts[cat.id] ?? 0);
            const active = selectedCat === cat.id && !searchQuery;
            return (
              <button
                key={cat.id}
                onClick={() => { setSelectedCat(cat.id); setSearchQuery(""); }}
                className={cn(
                  "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border whitespace-nowrap transition-all shrink-0",
                  active
                    ? cn(cat.cls, "opacity-100")
                    : "text-muted-foreground bg-transparent border-white/[0.07] hover:border-white/[0.14] hover:text-white",
                )}
              >
                <Icon className="w-3 h-3" />
                {cat.label}
                {count > 0 && (
                  <span className={cn(
                    "text-[10px] px-1 rounded-sm font-mono",
                    active ? "bg-black/20" : "bg-white/10",
                  )}>{count}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5">
        {searchResults !== null && (
          <p className="text-xs text-muted-foreground mb-4">
            {searchResults.length === 0
              ? `Sin resultados para "${searchQuery}"`
              : `${searchResults.length} resultado${searchResults.length !== 1 ? "s" : ""} para "${searchQuery}"`}
          </p>
        )}

        {loading ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        ) : displayed.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-52 text-center gap-3"
          >
            <div className="w-16 h-16 rounded-2xl bg-primary/5 border border-primary/10 flex items-center justify-center">
              <Brain className="w-8 h-8 text-primary/30" />
            </div>
            <div>
              <p className="text-sm font-medium text-white">Sin recuerdos aún</p>
              <p className="text-xs text-muted-foreground mt-1 max-w-xs">
                La IA guarda información automáticamente durante las conversaciones, o puedes añadirla manualmente.
              </p>
            </div>
            <button
              onClick={() => setModalMem("new")}
              className="flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/20 text-primary text-sm rounded-lg hover:bg-primary/20 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Añadir primer recuerdo
            </button>
          </motion.div>
        ) : (
          <motion.div
            layout
            className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3"
          >
            <AnimatePresence mode="popLayout">
              {displayed.map(mem => (
                <MemoryCard
                  key={mem.id}
                  mem={mem}
                  onEdit={m => setModalMem(m)}
                  onDelete={handleDelete}
                  onHistory={m => setHistoryMem(m)}
                />
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </div>

      {/* ── Modal ── */}
      <AnimatePresence>
        {modalMem !== null && (
          <MemoryModal
            mem={modalMem === "new" ? null : modalMem}
            onClose={() => setModalMem(null)}
            onSaved={handleSaved}
          />
        )}
      </AnimatePresence>

      {/* ── History Drawer ── */}
      <AnimatePresence>
        {historyMem && (
          <HistoryDrawer
            mem={historyMem}
            onClose={() => setHistoryMem(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
