import { useState, useEffect, useRef } from "react";
import { Link, useLocation } from "wouter";
import { authFetch } from "@/lib/authFetch";
import {
  BookOpen, Search, ChevronRight, Menu, X, Home,
  Clock, Edit3, FileText, BarChart2, MessageSquare,
  Calendar, Shield, ClipboardList, Users, Bot,
  Zap, MessageCircle, Rocket, Sun, Moon,
} from "lucide-react";

interface PageMeta {
  slug: string;
  title: string;
  chapterOrder: number;
  updatedAt?: string;
}

interface SearchResult {
  slug: string;
  title: string;
  snippet: string;
}

const CHAPTER_ICONS: Record<string, React.ReactNode> = {
  "inicio":             <Home className="w-4 h-4" />,
  "operaciones-diarias":<Clock className="w-4 h-4" />,
  "control-center":     <BarChart2 className="w-4 h-4" />,
  "crm":                <Users className="w-4 h-4" />,
  "ava":                <Bot className="w-4 h-4" />,
  "omni-intent":        <Zap className="w-4 h-4" />,
  "citas":              <Calendar className="w-4 h-4" />,
  "telegram":           <MessageSquare className="w-4 h-4" />,
  "whatsapp":           <MessageCircle className="w-4 h-4" />,
  "seguridad":          <Shield className="w-4 h-4" />,
  "auditoria":          <ClipboardList className="w-4 h-4" />,
  "primer-cliente":     <Rocket className="w-4 h-4" />,
  "roadmap":            <FileText className="w-4 h-4" />,
};

interface ManualLayoutProps {
  children: React.ReactNode;
  activeSlug?: string;
  canEdit?: boolean;
  onEditClick?: () => void;
}

export default function ManualLayout({ children, activeSlug, canEdit, onEditClick }: ManualLayoutProps) {
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [darkMode, setDarkMode] = useState(() => {
    const saved = localStorage.getItem("manual-dark");
    return saved !== null ? saved === "true" : true;
  });
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const [, navigate] = useLocation();
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    authFetch("/api/docs")
      .then(r => r.json())
      .then(d => setPages(d.pages ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    localStorage.setItem("manual-dark", String(darkMode));
  }, [darkMode]);

  useEffect(() => {
    if (!searchQuery.trim()) { setSearchResults([]); setShowSearch(false); return; }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await authFetch(`/api/docs/search?q=${encodeURIComponent(searchQuery)}`);
        const d = await r.json();
        setSearchResults(d.results ?? []);
        setShowSearch(true);
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [searchQuery]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (searchRef.current && !searchRef.current.contains(e.target as Node)) {
        setShowSearch(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const bg     = darkMode ? "bg-gray-950" : "bg-gray-50";
  const sidebar = darkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200";
  const text    = darkMode ? "text-gray-100" : "text-gray-900";
  const muted   = darkMode ? "text-gray-400" : "text-gray-500";
  const hover   = darkMode ? "hover:bg-gray-800" : "hover:bg-gray-100";
  const active  = darkMode ? "bg-blue-900/40 text-blue-300 border-l-2 border-blue-400" : "bg-blue-50 text-blue-700 border-l-2 border-blue-500";
  const topbar  = darkMode ? "bg-gray-900/80 border-gray-800" : "bg-white/80 border-gray-200";
  const input   = darkMode ? "bg-gray-800 border-gray-700 text-gray-100 placeholder-gray-500" : "bg-gray-100 border-gray-200 text-gray-900 placeholder-gray-400";
  const card    = darkMode ? "bg-gray-900 border-gray-800" : "bg-white border-gray-200";

  function goToChapter(slug: string) {
    navigate(`/manual/${slug}`);
    setSidebarOpen(false);
    setSearchQuery("");
    setShowSearch(false);
  }

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-inherit">
        <Link href="/manual">
          <div className={`flex items-center gap-2 cursor-pointer ${text}`}>
            <BookOpen className="w-5 h-5 text-blue-400" />
            <span className="font-bold text-sm">Manual OmniTech</span>
          </div>
        </Link>
      </div>
      <nav className="flex-1 overflow-y-auto py-2">
        {pages.map(p => (
          <button
            key={p.slug}
            onClick={() => goToChapter(p.slug)}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all ${activeSlug === p.slug ? active : `${muted} ${hover}`}`}
          >
            <span className="shrink-0">{CHAPTER_ICONS[p.slug] ?? <FileText className="w-4 h-4" />}</span>
            <span className="truncate text-left">{p.title}</span>
          </button>
        ))}
      </nav>
      <div className={`p-3 border-t border-inherit text-xs ${muted}`}>
        {pages.length} capítulos
      </div>
    </div>
  );

  return (
    <div className={`min-h-screen ${bg} ${text}`}>
      {/* Top bar */}
      <header className={`fixed top-0 left-0 right-0 z-40 h-14 flex items-center gap-3 px-4 border-b backdrop-blur-sm ${topbar}`}>
        {/* Mobile menu toggle */}
        <button
          className={`lg:hidden p-1.5 rounded ${hover}`}
          onClick={() => setSidebarOpen(o => !o)}
        >
          {sidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>

        {/* Logo */}
        <Link href="/manual">
          <div className="flex items-center gap-2 cursor-pointer">
            <BookOpen className="w-4 h-4 text-blue-400 hidden lg:block" />
            <span className="font-semibold text-sm hidden lg:block">Manual OmniTech</span>
          </div>
        </Link>

        {/* Search */}
        <div ref={searchRef} className="relative flex-1 max-w-lg mx-auto">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border ${input}`}>
            <Search className="w-4 h-4 shrink-0 text-gray-400" />
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => searchResults.length > 0 && setShowSearch(true)}
              placeholder="Buscar en el manual…"
              className="bg-transparent text-sm flex-1 outline-none"
            />
            {searching && <span className="text-xs text-gray-400">…</span>}
          </div>
          {showSearch && searchResults.length > 0 && (
            <div className={`absolute top-full mt-1 left-0 right-0 rounded-lg border shadow-xl z-50 ${card} overflow-hidden max-h-80 overflow-y-auto`}>
              {searchResults.map(r => (
                <button
                  key={r.slug}
                  onClick={() => { goToChapter(r.slug); setShowSearch(false); }}
                  className={`w-full text-left px-4 py-3 border-b border-inherit last:border-0 ${hover} transition-colors`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span>{CHAPTER_ICONS[r.slug] ?? <FileText className="w-3.5 h-3.5" />}</span>
                    <span className="font-medium text-sm">{r.title}</span>
                  </div>
                  <p className={`text-xs ${muted} line-clamp-2`}>{r.snippet.replace(/#+\s*/g, "").slice(0, 120)}…</p>
                </button>
              ))}
            </div>
          )}
          {showSearch && searchQuery && searchResults.length === 0 && !searching && (
            <div className={`absolute top-full mt-1 left-0 right-0 rounded-lg border shadow-xl z-50 ${card} px-4 py-3`}>
              <p className={`text-sm ${muted}`}>Sin resultados para "{searchQuery}"</p>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto shrink-0">
          {canEdit && onEditClick && (
            <button
              onClick={onEditClick}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs rounded-lg transition-colors"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Editar</span>
            </button>
          )}
          <button
            onClick={() => setDarkMode(d => !d)}
            className={`p-1.5 rounded-lg ${hover} transition-colors`}
            title={darkMode ? "Modo claro" : "Modo oscuro"}
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
          <Link href="/dashboard">
            <button className={`p-1.5 rounded-lg ${hover} transition-colors`} title="Volver al CRM">
              <ChevronRight className="w-4 h-4 rotate-180" />
            </button>
          </Link>
        </div>
      </header>

      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-30 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <div className="flex pt-14">
        {/* Desktop sidebar */}
        <aside className={`hidden lg:flex flex-col fixed left-0 top-14 bottom-0 w-60 border-r ${sidebar} z-20`}>
          <SidebarContent />
        </aside>

        {/* Mobile sidebar */}
        <aside
          className={`lg:hidden fixed left-0 top-14 bottom-0 w-64 border-r ${sidebar} z-30 transition-transform duration-200 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <SidebarContent />
        </aside>

        {/* Main content */}
        <main className="flex-1 lg:ml-60 min-h-[calc(100vh-56px)]">
          {children}
        </main>
      </div>
    </div>
  );
}
