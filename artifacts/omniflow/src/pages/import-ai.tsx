import { useState, useRef, useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/authFetch";
import {
  Upload, Camera, FileText, FileSpreadsheet, Image as ImageIcon, Loader2,
  CheckCircle2, AlertTriangle, Zap, Clock, Users, BarChart3, History,
  ArrowRight, RefreshCw, X, Edit2, Check, Bot, Sparkles, ScanLine,
  FileUp, ChevronRight, XCircle, Plus,
} from "lucide-react";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Step = "upload" | "analyzing" | "review" | "duplicates" | "done";
type Tab  = "import" | "history" | "dashboard";

interface ExtractedRecord {
  name?: string; first_name?: string; last_name?: string;
  email?: string; phone?: string; company?: string; position?: string;
  address?: string; website?: string; cif?: string; notes?: string;
  value?: number; tags?: string; status?: string;
  extra?: Record<string, unknown>;
  existingId?: number; skipImport?: boolean; _edited?: boolean;
}

interface AnalysisResult {
  detected_type: string; confidence: number;
  suggested_destination: string; summary: string; language: string;
  records: ExtractedRecord[];
  fileName: string; fileType: string;
}

interface HistoryItem {
  id: number; file_name: string; file_type: string;
  detected_type: string; confidence_pct: number;
  records_created: number; suggested_dest: string; created_at: string;
}

interface DashboardData {
  totalImports: number; totalRecords: number; totalErrors: number;
  timeSavedMin: number;
  byType: Array<{ detected_type: string; cnt: number }>;
}

interface DuplicateResult { hasDuplicate: boolean; existing: { id: number; name: string; email: string } | null }

const TYPE_LABELS: Record<string, string> = {
  contact: "Contacto", contact_list: "Lista de Contactos", invoice: "Factura",
  contract: "Contrato", quote: "Presupuesto", lead: "Lead",
  business_card: "Tarjeta de Visita", internal_document: "Documento Interno", other: "Otro",
};
const TYPE_ICONS: Record<string, React.ElementType> = {
  contact: Users, contact_list: Users, invoice: FileText, contract: FileText,
  quote: FileText, lead: Users, business_card: Users, internal_document: FileText, other: FileText,
};
const ACCEPTED_TYPES = ".pdf,.xlsx,.xls,.csv,.txt,.docx,.jpg,.jpeg,.png,.webp,.heic,.gif";

function ConfidenceBar({ pct }: { pct: number }) {
  const color = pct >= 90 ? "bg-emerald-500" : pct >= 70 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 bg-white/5 rounded-full h-1.5">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold tabular-nums ${pct >= 90 ? "text-emerald-400" : pct >= 70 ? "text-amber-400" : "text-red-400"}`}>{pct}%</span>
    </div>
  );
}

function DropZone({ onFile, disabled }: { onFile: (f: File) => void; disabled: boolean }) {
  const [dragging, setDragging] = useState(false);
  const inputRef  = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) onFile(file);
  }, [onFile]);

  return (
    <div className="space-y-4">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => !disabled && inputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
          dragging ? "border-violet-500 bg-violet-500/5" : disabled ? "border-white/5 opacity-50" : "border-white/10 hover:border-violet-500/50 hover:bg-white/[0.01]"
        }`}
      >
        <div className="flex flex-col items-center gap-4">
          <div className={`w-16 h-16 rounded-2xl flex items-center justify-center ${dragging ? "bg-violet-600" : "bg-white/[0.05]"}`}>
            <FileUp size={28} className={dragging ? "text-white" : "text-slate-500"} />
          </div>
          <div>
            <p className="text-white font-semibold text-lg">Arrastra tu documento aquí</p>
            <p className="text-slate-500 text-sm mt-1">o haz clic para seleccionar</p>
          </div>
          <div className="flex flex-wrap gap-2 justify-center">
            {["PDF", "Excel", "CSV", "JPG", "PNG", "WEBP"].map(t => (
              <span key={t} className="text-xs bg-white/[0.04] border border-white/[0.06] text-slate-500 px-2.5 py-1 rounded-full">{t}</span>
            ))}
          </div>
        </div>
        <input ref={inputRef} type="file" accept={ACCEPTED_TYPES} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
      </div>

      {/* Camera button (mobile-first) */}
      <button
        onClick={() => cameraRef.current?.click()}
        disabled={disabled}
        className="w-full flex items-center justify-center gap-3 border border-white/[0.08] rounded-2xl py-4 text-slate-400 hover:text-white hover:border-violet-500/40 transition-all disabled:opacity-40"
      >
        <Camera size={20} />
        <span className="font-medium">Escanear con cámara</span>
        <ScanLine size={16} className="text-violet-400" />
      </button>
      <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); }} />
    </div>
  );
}

function RecordCard({
  record, index, duplicate, onUpdate, onSkip,
}: {
  record: ExtractedRecord; index: number;
  duplicate: DuplicateResult | null;
  onUpdate: (i: number, r: ExtractedRecord) => void;
  onSkip: (i: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [local, setLocal]     = useState({ ...record });

  const field = (key: keyof ExtractedRecord, label: string, type = "text") => (
    <div key={key}>
      <label className="block text-[11px] text-slate-600 uppercase tracking-wider mb-1">{label}</label>
      {editing ? (
        <input type={type} value={(local[key] as string) ?? ""} onChange={e => setLocal(p => ({ ...p, [key]: e.target.value }))}
          className="w-full bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-white text-sm focus:outline-none focus:border-violet-500" />
      ) : (
        <p className="text-white text-sm">{(record[key] as string) || <span className="text-slate-700 italic">—</span>}</p>
      )}
    </div>
  );

  return (
    <div className={`bg-[#0a0b1a] border rounded-2xl p-5 ${record.skipImport ? "opacity-40" : duplicate?.hasDuplicate ? "border-amber-500/30" : "border-white/[0.06]"}`}>
      <div className="flex items-start justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-violet-600/20 flex items-center justify-center">
            <span className="text-violet-400 text-xs font-bold">{index + 1}</span>
          </div>
          <div>
            <p className="text-white font-medium text-sm">{record.name || record.company || "Sin nombre"}</p>
            {record.company && record.name && <p className="text-slate-500 text-xs">{record.company}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!record.skipImport && (
            editing ? (
              <>
                <button onClick={() => { onUpdate(index, local); setEditing(false); }}
                  className="p-1.5 text-emerald-400 hover:bg-emerald-500/10 rounded-lg transition-all"><Check size={14} /></button>
                <button onClick={() => setEditing(false)} className="p-1.5 text-slate-500 hover:bg-white/5 rounded-lg transition-all"><X size={14} /></button>
              </>
            ) : (
              <button onClick={() => setEditing(true)} className="p-1.5 text-slate-500 hover:text-white hover:bg-white/5 rounded-lg transition-all"><Edit2 size={14} /></button>
            )
          )}
          <button onClick={() => onSkip(index)}
            className={`p-1.5 rounded-lg transition-all ${record.skipImport ? "text-violet-400 bg-violet-500/10" : "text-slate-500 hover:text-red-400 hover:bg-red-500/10"}`}>
            {record.skipImport ? <Plus size={14} /> : <XCircle size={14} />}
          </button>
        </div>
      </div>

      {duplicate?.hasDuplicate && !record.skipImport && (
        <div className="mb-4 flex items-center gap-2 text-amber-400 text-xs bg-amber-500/10 border border-amber-500/20 rounded-xl px-3 py-2">
          <AlertTriangle size={12} />
          <span>Ya existe: <strong>{duplicate.existing?.name}</strong> ({duplicate.existing?.email})</span>
          <button onClick={() => onUpdate(index, { ...record, existingId: duplicate.existing?.id })}
            className="ml-auto text-amber-400 hover:text-white underline">Actualizar</button>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 text-sm">
        {field("name", "Nombre")}
        {field("email", "Email", "email")}
        {field("phone", "Teléfono", "tel")}
        {field("company", "Empresa")}
        {field("position", "Cargo")}
        {field("tags", "Etiquetas")}
      </div>
    </div>
  );
}

export default function ImportAiPage() {
  const [tab,       setTab]       = useState<Tab>("import");
  const [step,      setStep]      = useState<Step>("upload");
  const [result,    setResult]    = useState<AnalysisResult | null>(null);
  const [records,   setRecords]   = useState<ExtractedRecord[]>([]);
  const [duplicates,setDuplicates]= useState<DuplicateResult[]>([]);
  const [fileName,  setFileName]  = useState("");
  const [doneResult,setDoneResult]= useState<{ created: number; updated: number } | null>(null);
  const qc = useQueryClient();

  const uploadMut = useMutation({
    mutationFn: (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      return authFetch(`${BASE}/api/import/upload`, { method: "POST", body: fd }).then(r => r.json() as Promise<AnalysisResult>);
    },
    onSuccess: async (data) => {
      setResult(data);
      const recs = data.records ?? [];
      setRecords(recs);

      // Check duplicates
      if (recs.length > 0) {
        const dupRes = await authFetch(`${BASE}/api/import/check-duplicates`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ records: recs }),
        }).then(r => r.json() as Promise<{ results: DuplicateResult[] }>);
        setDuplicates(dupRes.results ?? []);
      }
      setStep("review");
    },
    onError: () => setStep("upload"),
  });

  const confirmMut = useMutation({
    mutationFn: () => authFetch(`${BASE}/api/import/confirm`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records }),
    }).then(r => r.json() as Promise<{ summary: { created: number; updated: number } }>),
    onSuccess: (data) => {
      setDoneResult(data.summary);
      setStep("done");
      qc.invalidateQueries({ queryKey: ["import-history"] });
      qc.invalidateQueries({ queryKey: ["import-dashboard"] });
    },
  });

  const { data: history = [], isLoading: histLoading } = useQuery<HistoryItem[]>({
    queryKey: ["import-history"],
    queryFn:  () => authFetch(`${BASE}/api/import/history`).then(r => r.json()),
    enabled:  tab === "history",
  });
  const { data: dashboard } = useQuery<DashboardData>({
    queryKey: ["import-dashboard"],
    queryFn:  () => authFetch(`${BASE}/api/import/dashboard`).then(r => r.json()),
    enabled:  tab === "dashboard",
  });

  const handleFile = (file: File) => {
    setFileName(file.name);
    setStep("analyzing");
    uploadMut.mutate(file);
  };

  const reset = () => {
    setStep("upload"); setResult(null); setRecords([]); setDuplicates([]); setFileName(""); setDoneResult(null);
  };

  const updateRecord = (i: number, r: ExtractedRecord) => setRecords(prev => prev.map((x, j) => j === i ? r : x));
  const toggleSkip   = (i: number) => setRecords(prev => prev.map((x, j) => j === i ? { ...x, skipImport: !x.skipImport } : x));

  const TypeIcon = result ? (TYPE_ICONS[result.detected_type] ?? FileText) : FileText;

  return (
    <div className="min-h-screen bg-[#070815] text-white">
      <div className="max-w-4xl mx-auto p-6 lg:p-8">

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-xl bg-violet-600 flex items-center justify-center">
              <Sparkles size={20} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Omni Import AI</h1>
              <p className="text-slate-500 text-sm">Captura, analiza e importa información automáticamente</p>
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06] mb-8 w-fit">
          {[
            { id: "import" as Tab,    label: "Importar",  icon: Upload   },
            { id: "history" as Tab,   label: "Historial", icon: History  },
            { id: "dashboard" as Tab, label: "Dashboard", icon: BarChart3},
          ].map(t => (
            <button key={t.id} onClick={() => { setTab(t.id); if (t.id === "import") reset(); }}
              className={`flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium transition-all ${tab === t.id ? "bg-violet-600 text-white" : "text-slate-400 hover:text-white"}`}>
              <t.icon size={15} /> {t.label}
            </button>
          ))}
        </div>

        {/* ── Tab: Import ── */}
        {tab === "import" && (
          <div>
            {/* Step indicator */}
            {step !== "upload" && (
              <div className="flex items-center gap-2 mb-6 text-sm">
                {(["upload", "analyzing", "review", "done"] as Step[]).filter(s => s !== "duplicates").map((s, i, arr) => (
                  <div key={s} className="flex items-center gap-2">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                      step === s ? "bg-violet-600 text-white" :
                      arr.indexOf(step) > i ? "bg-emerald-600 text-white" : "bg-white/[0.05] text-slate-600"
                    }`}>{arr.indexOf(step) > i ? <Check size={12} /> : i + 1}</div>
                    <span className={step === s ? "text-white" : "text-slate-600"}>
                      {s === "upload" ? "Subir" : s === "analyzing" ? "Analizar" : s === "review" ? "Revisar" : "Guardar"}
                    </span>
                    {i < arr.length - 1 && <ChevronRight size={14} className="text-slate-700" />}
                  </div>
                ))}
              </div>
            )}

            {/* STEP: Upload */}
            {step === "upload" && <DropZone onFile={handleFile} disabled={false} />}

            {/* STEP: Analyzing */}
            {step === "analyzing" && (
              <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-12 text-center">
                <div className="relative w-20 h-20 mx-auto mb-6">
                  <div className="w-20 h-20 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" />
                  <Bot size={28} className="text-violet-400 absolute inset-0 m-auto" />
                </div>
                <p className="text-white font-semibold text-lg mb-2">Analizando con IA...</p>
                <p className="text-slate-500 text-sm">{fileName}</p>
                <div className="mt-6 flex flex-col gap-2 max-w-xs mx-auto text-left">
                  {["Leyendo documento", "Clasificando tipo", "Extrayendo datos", "Detectando duplicados"].map((s, i) => (
                    <div key={s} className="flex items-center gap-3 text-sm">
                      <div className="w-4 h-4 rounded-full border-2 border-violet-500/30 border-t-violet-500 animate-spin" style={{ animationDelay: `${i * 0.2}s` }} />
                      <span className="text-slate-500">{s}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* STEP: Review */}
            {step === "review" && result && (
              <div className="space-y-5">
                {/* Classification card */}
                <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
                  <div className="flex items-start justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 rounded-xl bg-violet-600/20 flex items-center justify-center">
                        <TypeIcon size={22} className="text-violet-400" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-white font-semibold">{TYPE_LABELS[result.detected_type] ?? result.detected_type}</p>
                          <span className="text-xs bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full">Detectado</span>
                        </div>
                        <p className="text-slate-500 text-sm mt-0.5">{result.summary}</p>
                      </div>
                    </div>
                    <div className="text-right min-w-[120px]">
                      <p className="text-xs text-slate-600 mb-1">Confianza</p>
                      <ConfidenceBar pct={result.confidence} />
                      <p className="text-xs text-slate-600 mt-2">→ {result.suggested_destination}</p>
                    </div>
                  </div>
                </div>

                {/* Records */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <p className="text-white font-semibold text-sm">{records.length} registro{records.length !== 1 ? "s" : ""} encontrado{records.length !== 1 ? "s" : ""}</p>
                    <p className="text-slate-600 text-xs">{records.filter(r => !r.skipImport).length} seleccionado{records.filter(r => !r.skipImport).length !== 1 ? "s" : ""} para importar</p>
                  </div>
                  {records.map((r, i) => (
                    <RecordCard key={i} record={r} index={i} duplicate={duplicates[i] ?? null}
                      onUpdate={updateRecord} onSkip={toggleSkip} />
                  ))}
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                  <button onClick={reset} className="px-5 py-3 border border-white/10 rounded-xl text-slate-400 hover:text-white text-sm transition-all">
                    Cancelar
                  </button>
                  <button onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending || records.filter(r => !r.skipImport).length === 0}
                    className="flex-1 flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white font-semibold rounded-xl py-3 text-sm transition-all">
                    {confirmMut.isPending ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                    Importar {records.filter(r => !r.skipImport).length} registro{records.filter(r => !r.skipImport).length !== 1 ? "s" : ""}
                  </button>
                </div>
              </div>
            )}

            {/* STEP: Done */}
            {step === "done" && doneResult && (
              <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-12 text-center">
                <div className="w-20 h-20 rounded-full bg-emerald-600/20 flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 size={36} className="text-emerald-400" />
                </div>
                <p className="text-white font-bold text-xl mb-2">¡Importación completada!</p>
                <div className="flex items-center justify-center gap-6 mt-6 mb-8">
                  {doneResult.created > 0 && (
                    <div className="text-center">
                      <p className="text-3xl font-bold text-violet-400">{doneResult.created}</p>
                      <p className="text-slate-500 text-sm mt-1">Creados</p>
                    </div>
                  )}
                  {doneResult.updated > 0 && (
                    <div className="text-center">
                      <p className="text-3xl font-bold text-blue-400">{doneResult.updated}</p>
                      <p className="text-slate-500 text-sm mt-1">Actualizados</p>
                    </div>
                  )}
                </div>
                <div className="flex gap-3 justify-center">
                  <a href="/clients" className="flex items-center gap-2 px-5 py-3 border border-white/10 rounded-xl text-slate-400 hover:text-white text-sm transition-all">
                    Ver en CRM <ArrowRight size={14} />
                  </a>
                  <button onClick={reset} className="flex items-center gap-2 px-5 py-3 bg-violet-600 hover:bg-violet-700 rounded-xl text-white text-sm font-medium transition-all">
                    <RefreshCw size={14} /> Nueva importación
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Tab: History ── */}
        {tab === "history" && (
          <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl overflow-hidden">
            <div className="px-6 py-4 border-b border-white/[0.06]">
              <p className="text-white font-semibold text-sm">Historial de importaciones</p>
            </div>
            {histLoading ? (
              <div className="flex items-center justify-center py-16"><Loader2 size={28} className="animate-spin text-violet-400" /></div>
            ) : history.length === 0 ? (
              <div className="text-center py-16">
                <Upload size={36} className="mx-auto mb-3 text-slate-700" />
                <p className="text-slate-500 text-sm">Aún no hay importaciones</p>
              </div>
            ) : (
              <table className="w-full">
                <thead><tr className="border-b border-white/[0.06]">
                  {["Archivo", "Tipo detectado", "Confianza", "Registros creados", "Destino", "Fecha"].map(h => (
                    <th key={h} className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider px-5 py-3">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {history.map(item => (
                    <tr key={item.id} className="border-b border-white/[0.04] hover:bg-white/[0.01]">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <FileText size={14} className="text-violet-400 shrink-0" />
                          <span className="text-white text-xs truncate max-w-[140px]">{item.file_name}</span>
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <span className="text-xs bg-violet-500/10 text-violet-400 border border-violet-500/20 px-2 py-0.5 rounded-full">
                          {TYPE_LABELS[item.detected_type] ?? item.detected_type}
                        </span>
                      </td>
                      <td className="px-5 py-3 w-28"><ConfidenceBar pct={item.confidence_pct ?? 0} /></td>
                      <td className="px-5 py-3 text-emerald-400 text-sm font-medium">{item.records_created ?? 0}</td>
                      <td className="px-5 py-3 text-slate-500 text-xs">{item.suggested_dest ?? "—"}</td>
                      <td className="px-5 py-3 text-slate-600 text-xs whitespace-nowrap">
                        {new Date(item.created_at).toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {/* ── Tab: Dashboard ── */}
        {tab === "dashboard" && dashboard && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { icon: Upload,       label: "Total importaciones", value: dashboard.totalImports,                  color: "bg-violet-600" },
                { icon: Users,        label: "Registros importados", value: dashboard.totalRecords,                  color: "bg-emerald-600" },
                { icon: Zap,          label: "Errores detectados",   value: dashboard.totalErrors,                   color: "bg-red-600"     },
                { icon: Clock,        label: "Tiempo ahorrado",      value: `~${dashboard.timeSavedMin} min`,        color: "bg-blue-600"    },
              ].map(card => (
                <div key={card.label} className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-5">
                  <div className={`w-9 h-9 rounded-xl ${card.color} flex items-center justify-center mb-3`}>
                    <card.icon size={18} className="text-white" />
                  </div>
                  <p className="text-2xl font-bold text-white">{card.value}</p>
                  <p className="text-slate-500 text-xs mt-1">{card.label}</p>
                </div>
              ))}
            </div>

            {dashboard.byType.length > 0 && (
              <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
                <p className="text-white font-semibold text-sm mb-4">Por tipo de documento</p>
                <div className="space-y-3">
                  {dashboard.byType.map(bt => {
                    const maxCnt = Math.max(...dashboard.byType.map(x => x.cnt));
                    const pct    = maxCnt > 0 ? (bt.cnt / maxCnt) * 100 : 0;
                    return (
                      <div key={bt.detected_type} className="flex items-center gap-3">
                        <span className="text-slate-400 text-sm w-36 shrink-0">{TYPE_LABELS[bt.detected_type] ?? bt.detected_type}</span>
                        <div className="flex-1 bg-white/5 rounded-full h-2">
                          <div className="h-full bg-violet-500 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-white text-sm font-medium w-8 text-right">{bt.cnt}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            <div className="bg-[#0d0e1e] border border-white/[0.06] rounded-2xl p-6">
              <p className="text-white font-semibold text-sm mb-2 flex items-center gap-2">
                <Zap size={15} className="text-violet-400" /> ¿Qué puedo importar?
              </p>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4">
                {[
                  { icon: ImageIcon,        label: "Tarjetas de visita",  desc: "JPG, PNG, WEBP, HEIC" },
                  { icon: FileSpreadsheet,  label: "Listas de contactos", desc: "Excel, CSV"            },
                  { icon: FileText,         label: "Contratos",           desc: "PDF, DOCX"             },
                  { icon: FileText,         label: "Facturas",            desc: "PDF, imagen"           },
                  { icon: ScanLine,         label: "Escáner cámara",      desc: "Captura directa"       },
                  { icon: FileUp,           label: "Documentos varios",   desc: "PDF, TXT, DOCX"        },
                ].map(item => (
                  <div key={item.label} className="flex items-center gap-3 bg-white/[0.02] rounded-xl px-4 py-3">
                    <item.icon size={16} className="text-violet-400 shrink-0" />
                    <div>
                      <p className="text-white text-xs font-medium">{item.label}</p>
                      <p className="text-slate-600 text-[11px]">{item.desc}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
