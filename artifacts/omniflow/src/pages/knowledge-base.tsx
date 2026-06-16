import { useState, useEffect, useCallback } from "react";
import {
  BookOpen, Plus, Pencil, Trash2, RefreshCw, Search,
  CheckCircle2, XCircle, GripVertical, Tag, Eye, EyeOff,
  ChevronDown, Save, X, Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

// ── Types ─────────────────────────────────────────────────────────────────────
interface KBEntry {
  id:        number;
  title:     string;
  content:   string;
  category:  string;
  isActive:  boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

// ── Category badge ─────────────────────────────────────────────────────────────
const CAT_COLORS: Record<string, string> = {
  general:   "bg-slate-500/15 text-slate-300 border-slate-500/25",
  servicios: "bg-sky-500/15 text-sky-400 border-sky-500/25",
  precios:   "bg-emerald-500/15 text-emerald-400 border-emerald-500/25",
  empresa:   "bg-violet-500/15 text-violet-400 border-violet-500/25",
  faqs:      "bg-amber-500/15 text-amber-400 border-amber-500/25",
  contacto:  "bg-pink-500/15 text-pink-400 border-pink-500/25",
};

function CatBadge({ cat }: { cat: string }) {
  const cls = CAT_COLORS[cat.toLowerCase()] ?? CAT_COLORS.general;
  return (
    <Badge className={cn("text-[10px] capitalize border", cls)}>
      <Tag className="w-2.5 h-2.5 mr-1" />{cat}
    </Badge>
  );
}

// ── Entry editor modal ─────────────────────────────────────────────────────────
const CATEGORIES = ["general", "servicios", "precios", "empresa", "faqs", "contacto"];

function EntryModal({
  entry,
  onSave,
  onClose,
}: {
  entry: Partial<KBEntry> | null;
  onSave: (data: { title: string; content: string; category: string; sortOrder: number }) => Promise<void>;
  onClose: () => void;
}) {
  const [title,     setTitle]     = useState(entry?.title ?? "");
  const [content,   setContent]   = useState(entry?.content ?? "");
  const [category,  setCategory]  = useState(entry?.category ?? "general");
  const [sortOrder, setSortOrder] = useState(entry?.sortOrder ?? 0);
  const [saving,    setSaving]    = useState(false);

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) return;
    setSaving(true);
    await onSave({ title, content, category, sortOrder }).catch(() => {});
    setSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="bg-card border border-border rounded-2xl w-full max-w-xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border">
          <div className="flex items-center gap-2">
            <BookOpen className="w-4.5 h-4.5 text-violet-400" />
            <span className="font-semibold text-white">
              {entry?.id ? "Editar entrada" : "Nueva entrada"}
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-white transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Título *</label>
            <Input
              placeholder="Ej: Precios del plan Starter"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Categoría</label>
              <div className="relative">
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value)}
                  className="w-full h-9 pl-3 pr-8 rounded-md bg-background border border-input text-sm text-white appearance-none cursor-pointer"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
              </div>
            </div>
            <div className="w-28">
              <label className="text-xs font-medium text-muted-foreground mb-1.5 block">Orden</label>
              <Input
                type="number"
                min={0}
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
                className="text-center"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-muted-foreground mb-1.5 block">
              Contenido *
              <span className="ml-2 text-violet-400/70 font-normal">
                (El bot IA usará esto para responder a los clientes)
              </span>
            </label>
            <Textarea
              placeholder="Describe en detalle: qué es, qué incluye, precios, condiciones, etc."
              value={content}
              onChange={(e) => setContent(e.target.value)}
              rows={6}
              className="resize-y text-sm"
            />
            <p className="text-[10px] text-muted-foreground mt-1">{content.length} caracteres</p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2.5 px-5 pb-5">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={saving || !title.trim() || !content.trim()}
            className="bg-violet-600 hover:bg-violet-500 text-white"
          >
            {saving
              ? <><RefreshCw className="w-3.5 h-3.5 mr-1.5 animate-spin" />Guardando...</>
              : <><Save className="w-3.5 h-3.5 mr-1.5" />Guardar</>
            }
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Entry card ─────────────────────────────────────────────────────────────────
function EntryCard({
  entry,
  onEdit,
  onDelete,
  onToggle,
}: {
  entry:    KBEntry;
  onEdit:   () => void;
  onDelete: () => void;
  onToggle: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(
      "bg-card border border-border rounded-xl overflow-hidden transition-opacity",
      !entry.isActive && "opacity-50",
    )}>
      <div className="flex items-start gap-3 px-4 py-3">
        <GripVertical className="w-4 h-4 text-muted-foreground/30 shrink-0 mt-0.5 cursor-grab" />

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="text-sm font-medium text-white">{entry.title}</span>
            <CatBadge cat={entry.category} />
            {!entry.isActive && (
              <Badge className="bg-slate-600/20 text-slate-500 border-slate-600/30 text-[10px]">Inactivo</Badge>
            )}
          </div>

          <button
            onClick={() => setExpanded((v) => !v)}
            className="text-xs text-muted-foreground hover:text-white transition-colors text-left"
          >
            {expanded
              ? entry.content
              : entry.content.slice(0, 120) + (entry.content.length > 120 ? "…" : "")
            }
          </button>

          <p className="text-[10px] text-muted-foreground/50 mt-1.5">
            Orden: {entry.sortOrder} · {entry.content.length} chars
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={onToggle}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
            title={entry.isActive ? "Desactivar" : "Activar"}
          >
            {entry.isActive
              ? <Eye className="w-3.5 h-3.5 text-emerald-400" />
              : <EyeOff className="w-3.5 h-3.5 text-muted-foreground" />
            }
          </button>
          <button
            onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-white/5 transition-colors"
          >
            <Pencil className="w-3.5 h-3.5 text-sky-400" />
          </button>
          <button
            onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-500/10 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-400/70 hover:text-red-400" />
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function KnowledgeBasePage() {
  const { toast } = useToast();
  const [entries,  setEntries]  = useState<KBEntry[]>([]);
  const [loading,  setLoading]  = useState(false);
  const [search,   setSearch]   = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [modal,    setModal]    = useState<{ open: boolean; entry: Partial<KBEntry> | null }>({
    open: false, entry: null,
  });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await authFetch(`${BASE}/api/knowledge-base`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setEntries(await res.json() as KBEntry[]);
    } catch (e) {
      toast({ title: "Error al cargar", description: String(e), variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async (data: { title: string; content: string; category: string; sortOrder: number }) => {
    const id = modal.entry?.id;
    try {
      const res = await authFetch(
        id ? `${BASE}/api/knowledge-base/${id}` : `${BASE}/api/knowledge-base`,
        {
          method: id ? "PUT" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      toast({ title: id ? "Entrada actualizada ✓" : "Entrada creada ✓" });
      setModal({ open: false, entry: null });
      await load();
    } catch (e) {
      toast({ title: "Error al guardar", description: String(e), variant: "destructive" });
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm("¿Eliminar esta entrada de la base de conocimiento?")) return;
    try {
      await authFetch(`${BASE}/api/knowledge-base/${id}`, { method: "DELETE" });
      toast({ title: "Entrada eliminada" });
      setEntries((prev) => prev.filter((e) => e.id !== id));
    } catch (e) {
      toast({ title: "Error al eliminar", description: String(e), variant: "destructive" });
    }
  };

  const handleToggle = async (entry: KBEntry) => {
    try {
      await authFetch(`${BASE}/api/knowledge-base/${entry.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: !entry.isActive }),
      });
      setEntries((prev) => prev.map((e) => e.id === entry.id ? { ...e, isActive: !e.isActive } : e));
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
  };

  const allCats  = ["all", ...new Set(entries.map((e) => e.category))];
  const filtered = entries.filter((e) =>
    (catFilter === "all" || e.category === catFilter) &&
    (search.trim() === "" || e.title.toLowerCase().includes(search.toLowerCase()) || e.content.toLowerCase().includes(search.toLowerCase())),
  );

  const activeCount   = entries.filter((e) => e.isActive).length;
  const inactiveCount = entries.filter((e) => !e.isActive).length;

  return (
    <div className="space-y-5 animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-violet-500/15 border border-violet-500/25 flex items-center justify-center">
            <BookOpen className="w-4.5 h-4.5 text-violet-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Base de Conocimiento</h1>
            <p className="text-xs text-muted-foreground">
              El bot IA usa este contenido para responder en Telegram y WhatsApp
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={load} disabled={loading}>
            <RefreshCw className={cn("w-3.5 h-3.5 mr-1.5", loading && "animate-spin")} />
            Actualizar
          </Button>
          <Button
            size="sm"
            onClick={() => setModal({ open: true, entry: null })}
            className="bg-violet-600 hover:bg-violet-500 text-white"
          >
            <Plus className="w-3.5 h-3.5 mr-1.5" />
            Nueva entrada
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Total entradas</p>
          <p className="text-xl font-bold text-white">{entries.length}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Activas</p>
          <p className="text-xl font-bold text-emerald-400">{activeCount}</p>
        </div>
        <div className="bg-card border border-border rounded-xl p-3">
          <p className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">Inactivas</p>
          <p className="text-xl font-bold text-slate-500">{inactiveCount}</p>
        </div>
      </div>

      {/* IA context info */}
      <div className="bg-violet-500/5 border border-violet-500/20 rounded-xl p-4 flex items-start gap-3">
        <Sparkles className="w-4 h-4 text-violet-400 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-medium text-white mb-1">¿Cómo funciona?</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            El asistente IA de Telegram lee automáticamente las entradas <span className="text-emerald-400">activas</span> de esta base de conocimiento
            para responder preguntas sobre tus servicios, precios y empresa.
            Añade entradas detalladas con precios, FAQs y descripciones de tus servicios para mejorar las respuestas.
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            placeholder="Buscar en la base de conocimiento..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 text-sm"
          />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {allCats.map((cat) => (
            <button
              key={cat}
              onClick={() => setCatFilter(cat)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border",
                catFilter === cat
                  ? "bg-violet-600 text-white border-violet-500"
                  : "bg-card border-border text-muted-foreground hover:text-white",
              )}
            >
              {cat === "all" ? "Todas" : cat.charAt(0).toUpperCase() + cat.slice(1)}
            </button>
          ))}
        </div>
      </div>

      {/* Entry list */}
      {loading && (
        <div className="flex items-center justify-center py-16">
          <RefreshCw className="w-6 h-6 text-violet-400 animate-spin" />
        </div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <BookOpen className="w-12 h-12 text-muted-foreground/20 mb-4" />
          <p className="text-white font-medium mb-1">Sin entradas</p>
          <p className="text-sm text-muted-foreground max-w-sm mb-5">
            {search || catFilter !== "all"
              ? "Sin resultados para los filtros actuales."
              : "Añade información sobre tu empresa, servicios y precios para que el bot IA pueda responder mejor."}
          </p>
          {!search && catFilter === "all" && (
            <Button
              size="sm"
              onClick={() => setModal({ open: true, entry: null })}
              className="bg-violet-600 hover:bg-violet-500 text-white"
            >
              <Plus className="w-3.5 h-3.5 mr-1.5" />
              Añadir primera entrada
            </Button>
          )}
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="space-y-2">
          {filtered.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onEdit={() => setModal({ open: true, entry })}
              onDelete={() => handleDelete(entry.id)}
              onToggle={() => handleToggle(entry)}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {modal.open && (
        <EntryModal
          entry={modal.entry}
          onSave={handleSave}
          onClose={() => setModal({ open: false, entry: null })}
        />
      )}
    </div>
  );
}
