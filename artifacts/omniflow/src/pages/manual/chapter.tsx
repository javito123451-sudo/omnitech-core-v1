import { useEffect, useState, useCallback } from "react";
import { useParams, useLocation } from "wouter";
import ManualLayout from "@/components/layout/ManualLayout";
import { authFetch } from "@/lib/authFetch";
import {
  ChevronRight, Clock, User, GitBranch, Save, X,
  RotateCcw, Loader2, AlertCircle, CheckCircle,
} from "lucide-react";

interface DocsPage {
  id: number;
  slug: string;
  title: string;
  chapterOrder: number;
  content: string;
  updatedAt?: string;
  updatedByEmail?: string;
  currentVersion: number;
}

interface Version {
  id: number;
  versionNumber: number;
  authorEmail?: string;
  changeNote?: string;
  createdAt?: string;
}

// Simple markdown renderer
function MarkdownRenderer({ content }: { content: string }) {
  const html = parseMarkdown(content);
  return (
    <div
      className="prose-manual"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function parseMarkdown(md: string): string {
  const lines = md.split("\n");
  const out: string[] = [];
  let inList = false;
  let inTable = false;

  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];

    // Headings
    if (/^#{1,6}\s/.test(line)) {
      if (inList) { out.push("</ul>"); inList = false; }
      if (inTable) { out.push("</tbody></table>"); inTable = false; }
      const level = line.match(/^(#+)/)?.[1].length ?? 1;
      const text = line.replace(/^#+\s*/, "");
      const cls = [
        "text-3xl font-bold mb-4 mt-8 text-white",
        "text-2xl font-semibold mb-3 mt-7 text-white border-b border-gray-700 pb-2",
        "text-xl font-semibold mb-2 mt-6 text-gray-100",
        "text-lg font-medium mb-2 mt-5 text-gray-200",
        "text-base font-medium mb-1 mt-4 text-gray-300",
        "text-sm font-medium mb-1 mt-3 text-gray-400",
      ][level - 1];
      const id = text.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
      out.push(`<h${level} id="${id}" class="${cls}">${escHtml(text)}</h${level}>`);
      continue;
    }

    // Table row
    if (/^\|/.test(line)) {
      if (inList) { out.push("</ul>"); inList = false; }
      if (!inTable) {
        out.push('<div class="overflow-x-auto my-4"><table class="w-full text-sm border-collapse">');
        inTable = true;
      }
      const cells = line.split("|").slice(1, -1).map(c => c.trim());
      const isSep = cells.every(c => /^[-:]+$/.test(c));
      if (isSep) {
        out.push("<tbody>");
      } else {
        const isHeader = i === 0 || /^#{1,6}\s/.test(lines[i - 1] ?? "") || !inTable;
        const tag = (out[out.length - 1] === "<tbody>" || out.some(l => l === "<tbody>")) ? "td" : "th";
        out.push(`<tr>${cells.map(c => `<${tag} class="border border-gray-700 px-3 py-2 text-gray-300">${inlineMarkdown(c)}</${tag}>`).join("")}</tr>`);
      }
      continue;
    }

    if (inTable && !/^\|/.test(line)) {
      out.push("</tbody></table></div>");
      inTable = false;
    }

    // List item
    if (/^[-*]\s/.test(line)) {
      if (inTable) { out.push("</tbody></table></div>"); inTable = false; }
      if (!inList) { out.push('<ul class="list-disc pl-6 my-3 space-y-1">'); inList = true; }
      const text = line.replace(/^[-*]\s/, "");
      out.push(`<li class="text-gray-300">${inlineMarkdown(text)}</li>`);
      continue;
    }

    // Numbered list
    if (/^\d+\.\s/.test(line)) {
      if (inTable) { out.push("</tbody></table></div>"); inTable = false; }
      if (inList) { out.push("</ul>"); inList = false; }
      if (!out[out.length - 1]?.startsWith("<ol")) {
        out.push('<ol class="list-decimal pl-6 my-3 space-y-1">');
      }
      const text = line.replace(/^\d+\.\s/, "");
      out.push(`<li class="text-gray-300">${inlineMarkdown(text)}</li>`);
      const nextLine = lines[i + 1] ?? "";
      if (!nextLine || !/^\d+\.\s/.test(nextLine)) {
        out.push("</ol>");
      }
      continue;
    }

    // Blockquote / note
    if (/^>\s/.test(line)) {
      if (inList) { out.push("</ul>"); inList = false; }
      const text = line.replace(/^>\s/, "");
      out.push(`<blockquote class="border-l-4 border-blue-500/40 pl-4 py-2 my-3 bg-blue-500/5 rounded-r text-gray-400 text-sm italic">${inlineMarkdown(text)}</blockquote>`);
      continue;
    }

    // Horizontal rule
    if (/^---+$/.test(line.trim())) {
      if (inList) { out.push("</ul>"); inList = false; }
      out.push('<hr class="border-gray-700 my-6" />');
      continue;
    }

    // Checkbox
    if (/^- \[[ x]\]/.test(line)) {
      if (inList) { out.push("</ul>"); inList = false; }
      const checked = line.includes("[x]");
      const text = line.replace(/^- \[[ x]\]\s*/, "");
      out.push(`<div class="flex items-start gap-2 my-1.5"><span class="mt-0.5 text-${checked ? "green-400" : "gray-600"}">${checked ? "☑" : "☐"}</span><span class="text-gray-300 text-sm">${inlineMarkdown(text)}</span></div>`);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      if (inList) { out.push("</ul>"); inList = false; }
      if (inTable) { out.push("</tbody></table></div>"); inTable = false; }
      out.push('<div class="h-3"></div>');
      continue;
    }

    // Plain paragraph
    if (inList) { out.push("</ul>"); inList = false; }
    out.push(`<p class="text-gray-300 leading-relaxed">${inlineMarkdown(line)}</p>`);
  }

  if (inList) out.push("</ul>");
  if (inTable) out.push("</tbody></table></div>");

  return out.join("\n");
}

function escHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inlineMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/\*\*(.+?)\*\*/g, '<strong class="text-white font-semibold">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="text-gray-200 italic">$1</em>')
    .replace(/`(.+?)`/g, '<code class="px-1.5 py-0.5 bg-gray-800 text-blue-300 rounded text-xs font-mono">$1</code>')
    .replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2" class="text-blue-400 hover:underline">$1</a>');
}

export default function ManualChapter() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const [, navigate] = useLocation();

  const [page, setPage] = useState<DocsPage | null>(null);
  const [canEdit, setCanEdit] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [editing, setEditing] = useState(false);
  const [editContent, setEditContent] = useState("");
  const [changeNote, setChangeNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [showVersions, setShowVersions] = useState(false);
  const [versions, setVersions] = useState<Version[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [restoring, setRestoring] = useState<number | null>(null);

  const loadPage = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const r = await authFetch(`/api/docs/${slug}`);
      if (r.status === 404) { setError("Página no encontrada"); setLoading(false); return; }
      const d = await r.json();
      setPage(d.page);
      setCanEdit(d.canEdit ?? false);
      setEditContent(d.page?.content ?? "");
    } catch {
      setError("Error al cargar la página");
    }
    setLoading(false);
  }, [slug]);

  useEffect(() => { loadPage(); }, [loadPage]);

  async function handleSave() {
    if (!editContent.trim()) return;
    setSaving(true);
    setSaveMsg(null);
    try {
      const r = await authFetch(`/api/docs/${slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: editContent, changeNote: changeNote || "Edición manual" }),
      });
      if (r.ok) {
        const d = await r.json();
        setPage(d.page);
        setEditing(false);
        setChangeNote("");
        setSaveMsg({ ok: true, text: "Cambios guardados correctamente" });
        setTimeout(() => setSaveMsg(null), 3000);
      } else {
        const d = await r.json();
        setSaveMsg({ ok: false, text: d.error ?? "Error al guardar" });
      }
    } catch {
      setSaveMsg({ ok: false, text: "Error de conexión" });
    }
    setSaving(false);
  }

  async function loadVersions() {
    setLoadingVersions(true);
    try {
      const r = await authFetch(`/api/docs/${slug}/versions`);
      const d = await r.json();
      setVersions(d.versions ?? []);
    } catch { setVersions([]); }
    setLoadingVersions(false);
  }

  async function handleRestore(versionNum: number) {
    if (!confirm(`¿Restaurar la versión ${versionNum}? El contenido actual se guardará como nueva versión.`)) return;
    setRestoring(versionNum);
    try {
      const r = await authFetch(`/api/docs/${slug}/restore/${versionNum}`, { method: "POST" });
      if (r.ok) {
        setShowVersions(false);
        setSaveMsg({ ok: true, text: `Versión ${versionNum} restaurada` });
        await loadPage();
        setTimeout(() => setSaveMsg(null), 3000);
      }
    } catch { setSaveMsg({ ok: false, text: "Error al restaurar" }); }
    setRestoring(null);
  }

  const isDark = localStorage.getItem("manual-dark") !== "false";
  const bg = isDark ? "bg-gray-900" : "bg-white";
  const border = isDark ? "border-gray-700" : "border-gray-200";
  const muted = isDark ? "text-gray-400" : "text-gray-500";

  return (
    <ManualLayout
      activeSlug={slug}
      canEdit={canEdit && !editing}
      onEditClick={() => { setEditing(true); setEditContent(page?.content ?? ""); }}
    >
      <div className="max-w-4xl mx-auto px-6 py-8">
        {/* Breadcrumbs */}
        <nav className={`flex items-center gap-1.5 text-xs ${muted} mb-6`}>
          <button onClick={() => navigate("/manual")} className="hover:text-blue-400 transition-colors">Manual</button>
          <ChevronRight className="w-3 h-3" />
          <span className="text-white">{page?.title ?? slug}</span>
        </nav>

        {/* Save notification */}
        {saveMsg && (
          <div className={`flex items-center gap-2 px-4 py-3 rounded-lg mb-4 text-sm ${saveMsg.ok ? "bg-green-900/30 border border-green-700 text-green-300" : "bg-red-900/30 border border-red-700 text-red-300"}`}>
            {saveMsg.ok ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            {saveMsg.text}
          </div>
        )}

        {loading && (
          <div className="flex items-center gap-3 py-20 justify-center text-gray-500">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span>Cargando…</span>
          </div>
        )}

        {error && (
          <div className="py-20 text-center">
            <AlertCircle className="w-8 h-8 text-red-400 mx-auto mb-3" />
            <p className="text-red-400">{error}</p>
            <button onClick={() => navigate("/manual")} className="mt-4 text-sm text-blue-400 hover:underline">← Volver al índice</button>
          </div>
        )}

        {!loading && !error && page && (
          <>
            {/* Meta */}
            <div className={`flex flex-wrap items-center gap-4 text-xs ${muted} mb-6 pb-4 border-b ${border}`}>
              <span className="flex items-center gap-1">
                <GitBranch className="w-3.5 h-3.5" />
                v{page.currentVersion}
              </span>
              {page.updatedAt && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3.5 h-3.5" />
                  {new Date(page.updatedAt).toLocaleDateString("es-ES", { day: "2-digit", month: "long", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                </span>
              )}
              {page.updatedByEmail && (
                <span className="flex items-center gap-1">
                  <User className="w-3.5 h-3.5" />
                  {page.updatedByEmail}
                </span>
              )}
              {canEdit && (
                <button
                  onClick={() => { setShowVersions(v => !v); if (!showVersions) loadVersions(); }}
                  className="flex items-center gap-1 hover:text-blue-400 transition-colors ml-auto"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Historial de versiones
                </button>
              )}
            </div>

            {/* Version history panel */}
            {showVersions && (
              <div className={`mb-6 rounded-xl border ${border} ${bg} overflow-hidden`}>
                <div className="px-4 py-3 border-b border-inherit flex items-center justify-between">
                  <h3 className="text-sm font-semibold">Historial de versiones</h3>
                  <button onClick={() => setShowVersions(false)}><X className="w-4 h-4 text-gray-500" /></button>
                </div>
                {loadingVersions ? (
                  <div className="px-4 py-6 flex items-center gap-2 text-gray-500 text-sm">
                    <Loader2 className="w-4 h-4 animate-spin" /> Cargando versiones…
                  </div>
                ) : versions.length === 0 ? (
                  <div className="px-4 py-6 text-sm text-gray-500">Sin historial de versiones anteriores.</div>
                ) : (
                  <div className="divide-y divide-inherit">
                    {versions.map(v => (
                      <div key={v.id} className="px-4 py-3 flex items-center justify-between text-sm">
                        <div>
                          <span className="font-mono text-blue-400 text-xs">v{v.versionNumber}</span>
                          <span className={`ml-3 ${muted}`}>{v.changeNote ?? "Sin nota"}</span>
                          {v.authorEmail && <span className={`ml-2 text-xs ${muted}`}>— {v.authorEmail}</span>}
                        </div>
                        <div className="flex items-center gap-3">
                          {v.createdAt && <span className={`text-xs ${muted}`}>{new Date(v.createdAt).toLocaleDateString("es-ES")}</span>}
                          <button
                            onClick={() => handleRestore(v.versionNumber)}
                            disabled={restoring === v.versionNumber}
                            className="text-xs text-orange-400 hover:text-orange-300 transition-colors disabled:opacity-50"
                          >
                            {restoring === v.versionNumber ? "Restaurando…" : "Restaurar"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Edit mode */}
            {editing ? (
              <div className="space-y-4">
                <div className={`rounded-xl border ${border} overflow-hidden`}>
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-inherit bg-gray-800/50">
                    <span className="text-xs text-gray-400 font-medium">Editar — Markdown</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setEditing(false); setEditContent(page.content); }}
                        className="text-xs text-gray-400 hover:text-gray-300 flex items-center gap-1"
                      >
                        <X className="w-3.5 h-3.5" /> Cancelar
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={editContent}
                    onChange={e => setEditContent(e.target.value)}
                    className="w-full h-[60vh] bg-gray-900 text-gray-200 font-mono text-sm p-4 outline-none resize-none"
                    spellCheck={false}
                  />
                </div>
                <div className="flex flex-col sm:flex-row gap-3">
                  <input
                    value={changeNote}
                    onChange={e => setChangeNote(e.target.value)}
                    placeholder="Nota del cambio (opcional)"
                    className="flex-1 px-3 py-2 bg-gray-800 border border-gray-700 text-gray-200 text-sm rounded-lg outline-none focus:border-blue-500"
                  />
                  <button
                    onClick={handleSave}
                    disabled={saving}
                    className="flex items-center justify-center gap-2 px-5 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {saving ? "Guardando…" : "Guardar cambios"}
                  </button>
                </div>
              </div>
            ) : (
              /* Rendered content */
              <article>
                <MarkdownRenderer content={page.content} />
              </article>
            )}
          </>
        )}

        {/* Bottom navigation */}
        {!loading && !error && page && (
          <div className={`mt-12 pt-6 border-t ${border} flex items-center justify-between`}>
            <button onClick={() => navigate("/manual")} className="text-sm text-blue-400 hover:underline">
              ← Volver al índice
            </button>
            <span className={`text-xs ${muted}`}>
              Capítulo {page.chapterOrder} de 13
            </span>
          </div>
        )}
      </div>
    </ManualLayout>
  );
}
