import { useState, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  FileText, Upload, CheckCircle2, Clock, AlertTriangle,
  FileDigit, FileSpreadsheet, Image, File,
  Search, Filter, Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { authFetch } from "@/lib/authFetch";
import { useToast } from "@/hooks/use-toast";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const CATEGORY_LABELS: Record<string, string> = {
  invoice: "Factura",
  expense: "Gasto",
  bank_statement: "Extracto bancario",
  tax_form: "Modelo fiscal",
  receipt: "Recibo",
  other: "Otro",
};

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  invoice: FileDigit,
  expense: FileText,
  bank_statement: FileSpreadsheet,
  tax_form: FileDigit,
  receipt: FileText,
  other: File,
};

const STATUS_COLORS: Record<string, string> = {
  pending: "text-amber-400 bg-amber-500/10",
  classified: "text-blue-400 bg-blue-500/10",
  verified: "text-emerald-400 bg-emerald-500/10",
  archived: "text-slate-400 bg-slate-500/10",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  classified: "Clasificado",
  verified: "Verificado",
  archived: "Archivado",
};

export default function TaxDocuments() {
  const [category, setCategory] = useState<string>("");
  const [year, setYear] = useState<number | undefined>(undefined);
  const [isUploading, setIsUploading] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: docs, isLoading } = useQuery({
    queryKey: ["tax-documents", category, year],
    queryFn: async () => {
      let url = `${BASE}/api/tax/documents`;
      const params = new URLSearchParams();
      if (category) params.append("category", category);
      if (year) params.append("year", String(year));
      if (params.toString()) url += `?${params.toString()}`;
      const r = await authFetch(url);
      if (!r.ok) throw new Error("Failed to load documents");
      return r.json();
    },
  });

  const uploadFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) {
      toast({ title: "Archivo demasiado grande", description: "El límite es 10MB.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("category", "other");
      formData.append("fiscalYear", String(new Date().getFullYear()));

      const r = await authFetch(`${BASE}/api/tax/documents/upload`, {
        method: "POST",
        body: formData,
      });

      if (!r.ok) {
        const err = await r.json().catch(() => ({ error: "Error al subir el archivo" }));
        throw new Error(err.error ?? "Error al subir el archivo");
      }

      toast({ title: "Documento subido correctamente" });
      queryClient.invalidateQueries({ queryKey: ["tax-documents"] });
    } catch (err) {
      toast({
        title: "No se pudo subir el documento",
        description: err instanceof Error ? err.message : "Error desconocido",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) uploadFile(file);
    e.target.value = ""; // allow re-selecting the same file
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) uploadFile(file);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <Filter size={16} className="text-slate-400" />
          <select
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="bg-slate-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
          >
            <option value="">Todas las categorías</option>
            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <select
          value={year ?? ""}
          onChange={(e) => setYear(e.target.value ? Number(e.target.value) : undefined)}
          className="bg-slate-800/60 border border-white/10 rounded-lg px-3 py-2 text-sm text-white"
        >
          <option value="">Todos los años</option>
          {[2024, 2025, 2026].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
      </div>

      {/* Document list */}
      <div className="bg-slate-900/60 border border-white/5 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-slate-400">
                <th className="text-left px-4 py-3 font-medium">Documento</th>
                <th className="text-left px-4 py-3 font-medium">Categoría</th>
                <th className="text-left px-4 py-3 font-medium">Año fiscal</th>
                <th className="text-left px-4 py-3 font-medium">Estado</th>
                <th className="text-left px-4 py-3 font-medium">Fecha</th>
              </tr>
            </thead>
            <tbody>
              {(docs ?? []).length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                    No hay documentos fiscales registrados
                  </td>
                </tr>
              ) : (
                (docs ?? []).map((doc: any) => {
                  const Icon = CATEGORY_ICONS[doc.category] ?? File;
                  return (
                    <tr key={doc.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-3">
                        <a
                          href={`${BASE}/api/tax/documents/${doc.id}/file`}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-3 hover:opacity-80"
                        >
                          <div className="w-8 h-8 rounded-lg bg-slate-800 flex items-center justify-center">
                            <Icon size={16} className="text-emerald-400" />
                          </div>
                          <div>
                            <div className="font-medium text-white">{doc.name}</div>
                            <div className="text-xs text-slate-500">{doc.fileType.toUpperCase()}</div>
                          </div>
                        </a>
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {CATEGORY_LABELS[doc.category] ?? doc.category}
                      </td>
                      <td className="px-4 py-3 text-slate-300">
                        {doc.fiscalYear ?? "—"}
                        {doc.quarter ? ` Q${doc.quarter}` : ""}
                      </td>
                      <td className="px-4 py-3">
                        <span className={cn(
                          "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium",
                          STATUS_COLORS[doc.status] ?? "text-slate-400 bg-slate-500/10",
                        )}>
                          {doc.status === "verified" ? <CheckCircle2 size={12} /> : <Clock size={12} />}
                          {STATUS_LABELS[doc.status] ?? doc.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">
                        {new Date(doc.createdAt).toLocaleDateString("es-ES")}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload zone — now wired to a real endpoint (FIX-AO) */}
      <div
        onClick={() => !isUploading && fileInputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={cn(
          "bg-slate-800/30 border border-dashed rounded-xl p-6 flex flex-col items-center justify-center text-center cursor-pointer transition-colors",
          isDragging ? "border-emerald-400 bg-emerald-500/5" : "border-white/10 hover:border-white/20",
          isUploading && "pointer-events-none opacity-70",
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          className="hidden"
          accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.xlsx,.xls,.csv"
          onChange={handleFileSelect}
        />
        {isUploading ? (
          <>
            <Loader2 size={24} className="text-emerald-400 mb-2 animate-spin" />
            <p className="text-sm text-slate-400">Subiendo documento…</p>
          </>
        ) : (
          <>
            <Upload size={24} className="text-slate-400 mb-2" />
            <p className="text-sm text-slate-400">
              Arrastra archivos aquí o haz clic para subir
            </p>
            <p className="text-xs text-slate-500 mt-1">
              PDF, Excel, CSV, imágenes (máx. 10MB)
            </p>
          </>
        )}
      </div>
    </div>
  );
}
