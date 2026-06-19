import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import ManualLayout from "@/components/layout/ManualLayout";
import { authFetch } from "@/lib/authFetch";
import {
  BookOpen, Home, Clock, BarChart2, Users, Bot, Zap,
  Calendar, MessageSquare, MessageCircle, Shield,
  ClipboardList, Rocket, FileText, ChevronRight,
} from "lucide-react";

interface PageMeta {
  slug: string;
  title: string;
  chapterOrder: number;
  updatedAt?: string;
}

const CHAPTER_ICONS: Record<string, React.ReactNode> = {
  "inicio":              <Home className="w-6 h-6" />,
  "operaciones-diarias": <Clock className="w-6 h-6" />,
  "control-center":      <BarChart2 className="w-6 h-6" />,
  "crm":                 <Users className="w-6 h-6" />,
  "ava":                 <Bot className="w-6 h-6" />,
  "omni-intent":         <Zap className="w-6 h-6" />,
  "citas":               <Calendar className="w-6 h-6" />,
  "telegram":            <MessageSquare className="w-6 h-6" />,
  "whatsapp":            <MessageCircle className="w-6 h-6" />,
  "seguridad":           <Shield className="w-6 h-6" />,
  "auditoria":           <ClipboardList className="w-6 h-6" />,
  "primer-cliente":      <Rocket className="w-6 h-6" />,
  "roadmap":             <FileText className="w-6 h-6" />,
};

const CHAPTER_COLORS: Record<string, string> = {
  "inicio":              "from-blue-500/20 to-blue-600/10 border-blue-500/30 text-blue-400",
  "operaciones-diarias": "from-purple-500/20 to-purple-600/10 border-purple-500/30 text-purple-400",
  "control-center":      "from-orange-500/20 to-orange-600/10 border-orange-500/30 text-orange-400",
  "crm":                 "from-green-500/20 to-green-600/10 border-green-500/30 text-green-400",
  "ava":                 "from-pink-500/20 to-pink-600/10 border-pink-500/30 text-pink-400",
  "omni-intent":         "from-yellow-500/20 to-yellow-600/10 border-yellow-500/30 text-yellow-400",
  "citas":               "from-cyan-500/20 to-cyan-600/10 border-cyan-500/30 text-cyan-400",
  "telegram":            "from-sky-500/20 to-sky-600/10 border-sky-500/30 text-sky-400",
  "whatsapp":            "from-emerald-500/20 to-emerald-600/10 border-emerald-500/30 text-emerald-400",
  "seguridad":           "from-red-500/20 to-red-600/10 border-red-500/30 text-red-400",
  "auditoria":           "from-amber-500/20 to-amber-600/10 border-amber-500/30 text-amber-400",
  "primer-cliente":      "from-violet-500/20 to-violet-600/10 border-violet-500/30 text-violet-400",
  "roadmap":             "from-teal-500/20 to-teal-600/10 border-teal-500/30 text-teal-400",
};

export default function ManualHome() {
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [loading, setLoading] = useState(true);
  const [, navigate] = useLocation();

  useEffect(() => {
    authFetch("/api/docs")
      .then(r => r.json())
      .then(d => { setPages(d.pages ?? []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <ManualLayout>
      <div className="max-w-5xl mx-auto px-6 py-10">
        {/* Hero */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-3 bg-blue-600/20 rounded-xl border border-blue-500/30">
              <BookOpen className="w-7 h-7 text-blue-400" />
            </div>
            <div>
              <h1 className="text-2xl font-bold">Manual Oficial de OmniTech Core</h1>
              <p className="text-gray-400 text-sm mt-0.5">Documentación interna — Versión 1.0</p>
            </div>
          </div>
          <p className="text-gray-400 max-w-2xl leading-relaxed">
            Guía completa de la plataforma SaaS OmniTech Core. Encontrarás procedimientos paso a paso,
            casos de uso, solución de incidencias y el roadmap del producto.
          </p>
        </div>

        {/* Chapters grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 9 }).map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-gray-800 animate-pulse" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {pages.map(p => {
              const colorClass = CHAPTER_COLORS[p.slug] ?? "from-gray-500/20 to-gray-600/10 border-gray-500/30 text-gray-400";
              return (
                <button
                  key={p.slug}
                  onClick={() => navigate(`/manual/${p.slug}`)}
                  className={`group text-left p-5 rounded-xl border bg-gradient-to-br ${colorClass} hover:scale-[1.02] transition-all duration-200 cursor-pointer`}
                >
                  <div className="flex items-start justify-between mb-3">
                    <span>{CHAPTER_ICONS[p.slug] ?? <FileText className="w-6 h-6" />}</span>
                    <ChevronRight className="w-4 h-4 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <h2 className="font-semibold text-sm text-white mb-1">{p.chapterOrder}. {p.title}</h2>
                  {p.updatedAt && (
                    <p className="text-xs opacity-60">
                      Actualizado {new Date(p.updatedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "short", year: "numeric" })}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Info footer */}
        <div className="mt-12 p-5 rounded-xl border border-gray-700 bg-gray-900/50">
          <h3 className="font-semibold mb-2 text-sm">Sobre este manual</h3>
          <ul className="text-xs text-gray-400 space-y-1.5">
            <li>• Documentación oficial interna de OmniTech Core v1.0 — junio 2026.</li>
            <li>• Puede ser editado por usuarios con rol <span className="text-blue-400 font-mono">SUPER_ADMIN</span> o <span className="text-blue-400 font-mono">STAFF_OMNITECH</span>.</li>
            <li>• Cada capítulo mantiene un historial completo de versiones.</li>
            <li>• Usa la barra de búsqueda superior para encontrar cualquier término.</li>
          </ul>
        </div>
      </div>
    </ManualLayout>
  );
}
