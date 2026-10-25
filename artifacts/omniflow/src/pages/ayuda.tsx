import { useMemo, useState } from "react";
import {
  Search, Rocket, Users, CalendarDays, Target, Bot, Ticket, Puzzle, LifeBuoy, Lightbulb,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

/**
 * Guía de uso para los usuarios de la plataforma (no solo super admins).
 * Contenido estático: no depende de la API /api/docs (que exige el módulo
 * omni_docs) ni de ningún módulo, así que la ve cualquier usuario con sesión
 * y workspace. El manual interno sigue en /manual.
 */

interface Section {
  id: string;
  title: string;
  icon: React.ReactNode;
  intro: string;
  steps?: string[];
  tips?: string[];
}

const SECTIONS: Section[] = [
  {
    id: "primeros-pasos",
    title: "Primeros pasos",
    icon: <Rocket className="w-5 h-5" />,
    intro:
      "Al entrar verás un menú lateral (en el móvil, el botón \"Más\"). Solo aparecen las secciones incluidas en tu plan, así que si algo que ves en esta guía no está en tu menú, es que tu plan no lo incluye.",
    steps: [
      "Empieza por Clientes: guarda ahí a las personas o empresas con las que trabajas.",
      "Después usa Calendario para apuntar citas, trabajos o llamadas.",
      "Si quieres seguir una venta, crea un deal en Pipeline.",
      "Si algo no funciona, abre un ticket en Soporte.",
    ],
    tips: ["La búsqueda de esta página filtra todas las secciones: prueba con \"cita\", \"etiqueta\" o \"cliente\"."],
  },
  {
    id: "clientes",
    title: "Clientes",
    icon: <Users className="w-5 h-5" />,
    intro:
      "Es tu agenda de contactos. Cada cliente tiene su ficha con datos de contacto, notas y etiquetas.",
    steps: [
      "Pulsa \"Nuevo Cliente\".",
      "Rellena nombre, email y, si quieres, teléfono, empresa, valor estimado, etiquetas y notas.",
      "Guarda. El cliente aparece en la lista y ya puedes buscarlo.",
      "Abre su ficha para ver y completar más datos: persona de contacto, ubicación, web, Instagram, fuente del lead, dolor principal, resultado y próxima acción.",
    ],
    tips: [
      "Las etiquetas se escriben separadas por comas (por ejemplo: \"urgente, vip\").",
      "El buscador encuentra por nombre, empresa o etiqueta.",
      "Usa el campo \"Próxima acción\" para no olvidar qué toca hacer con cada cliente.",
    ],
  },
  {
    id: "calendario",
    title: "Calendario y citas",
    icon: <CalendarDays className="w-5 h-5" />,
    intro:
      "Organiza tu agenda de días y semanas. Cada cita puede tener hora de inicio y fin, estado, lugar, etiquetas, recordatorio y notas.",
    steps: [
      "Pulsa \"Nueva cita\".",
      "Escribe un título y elige el inicio y el fin.",
      "Indica el estado, el lugar (oficina, Zoom, dirección del cliente…) y las notas.",
      "Si quieres que te avise, activa el recordatorio.",
      "Guarda. La cita aparece en el calendario.",
    ],
    tips: [
      "Las etiquetas sirven para filtrar y organizar: por ejemplo el equipo que hace el trabajo, o \"urgente\".",
      "Usa el estado para marcar lo pendiente, lo aplazado y lo hecho, y así ver de un vistazo qué falta.",
      "El calendario inteligente te deja describir la cita con tus palabras (\"llamada con Carlos mañana a las 10\") y la prepara por ti.",
    ],
  },
  {
    id: "pipeline",
    title: "Pipeline (seguimiento de ventas)",
    icon: <Target className="w-5 h-5" />,
    intro:
      "Muestra tus oportunidades de venta (deals) ordenadas por etapas, para ver en qué punto está cada una.",
    steps: [
      "Pulsa \"Nuevo Deal\" y elige la etapa inicial.",
      "Cuando la oportunidad avance, muévela a la etapa siguiente desde su tarjeta.",
      "Si se retrasa, puedes volver a la etapa anterior.",
    ],
  },
  {
    id: "ava",
    title: "Ava, tu asistente",
    icon: <Bot className="w-5 h-5" />,
    intro:
      "Ava es el asistente integrado. Puedes escribirle en lenguaje normal para consultar información de tu workspace o pedirle que prepare tareas.",
    steps: [
      "Abre el chat de Ava.",
      "Escribe lo que necesitas, por ejemplo: \"¿qué clientes tengo con la etiqueta urgente?\".",
      "Si te propone una acción (como crear una tarea), revisa el resumen y pulsa Confirmar. Hasta que confirmes, no se cambia nada.",
    ],
    tips: ["Si Ava se equivoca o no entiende, reformula la pregunta con más detalle."],
  },
  {
    id: "soporte",
    title: "Soporte e incidencias",
    icon: <Ticket className="w-5 h-5" />,
    intro: "Si algo falla o necesitas ayuda, abre un ticket y el equipo de OmniTech lo verá.",
    steps: [
      "Entra en Soporte y pulsa para crear un ticket nuevo.",
      "Pon un título claro, describe qué estabas haciendo y qué ha pasado, y elige categoría y prioridad.",
      "Puedes seguir el estado del ticket desde la misma pantalla.",
    ],
    tips: ["Cuanto más concreto sea el mensaje (qué pantalla, qué botón, qué error), más rápido se resuelve."],
  },
  {
    id: "modulos",
    title: "Otras secciones del menú",
    icon: <Puzzle className="w-5 h-5" />,
    intro:
      "Según tu plan puedes tener más herramientas: presupuestos, contabilidad, impuestos, estadísticas, conversaciones de WhatsApp y Telegram, automatizaciones, marketing y otras.",
    tips: [
      "Cada sección nueva se activa desde OmniTech: si te interesa alguna que no ves en el menú, pídela por Soporte.",
    ],
  },
  {
    id: "consejos",
    title: "Buenas costumbres",
    icon: <Lightbulb className="w-5 h-5" />,
    intro: "Tres hábitos que ahorran trabajo:",
    steps: [
      "Guarda al cliente antes de crear su cita, así todo queda enlazado en su ficha.",
      "Revisa el calendario al empezar el día y marca el estado de cada cita al terminar.",
      "Apunta en notas lo que se ha acordado: dentro de un mes lo agradecerás.",
    ],
  },
];

function matches(section: Section, q: string): boolean {
  if (!q) return true;
  const hay = [section.title, section.intro, ...(section.steps ?? []), ...(section.tips ?? [])]
    .join(" ")
    .toLowerCase();
  return hay.includes(q.toLowerCase());
}

export default function AyudaPage() {
  const [query, setQuery] = useState("");
  const visible = useMemo(() => SECTIONS.filter(s => matches(s, query.trim())), [query]);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 md:py-10">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2.5 rounded-xl bg-primary/15 border border-primary/30 text-primary">
          <LifeBuoy className="w-6 h-6" />
        </div>
        <div>
          <h1 className="text-xl md:text-2xl font-bold tracking-tight text-white">Guía de uso</h1>
          <p className="text-sm text-slate-400">Cómo sacar partido a OmniTech paso a paso.</p>
        </div>
      </div>

      <div className="relative my-5">
        <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
        <Input
          value={query}
          onChange={e => setQuery(e.target.value)}
          placeholder="Buscar en la guía…"
          className="pl-9"
        />
      </div>

      {!query && (
        <nav className="flex flex-wrap gap-2 mb-6" aria-label="Índice">
          {SECTIONS.map(s => (
            <a
              key={s.id}
              href={`#${s.id}`}
              className="text-xs px-3 py-1.5 rounded-full border border-white/10 text-slate-300 hover:text-white hover:border-white/30 transition-colors"
            >
              {s.title}
            </a>
          ))}
        </nav>
      )}

      <div className="space-y-4">
        {visible.map(s => (
          <Card key={s.id} id={s.id} className="scroll-mt-20">
            <CardContent className="p-5">
              <div className="flex items-center gap-2.5 mb-2 text-primary">
                {s.icon}
                <h2 className="text-base font-semibold text-white">{s.title}</h2>
              </div>
              <p className="text-sm text-slate-300 leading-relaxed">{s.intro}</p>

              {s.steps && (
                <ol className="mt-3 space-y-1.5 list-decimal list-inside text-sm text-slate-200">
                  {s.steps.map((step, i) => <li key={i} className="leading-relaxed">{step}</li>)}
                </ol>
              )}

              {s.tips && (
                <div className="mt-3 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-400 mb-1">Consejos</p>
                  <ul className="space-y-1 text-sm text-slate-300 list-disc list-inside">
                    {s.tips.map((tip, i) => <li key={i} className="leading-relaxed">{tip}</li>)}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        ))}

        {visible.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-10">
            No hay resultados para "{query}". Prueba con otra palabra o abre un ticket en Soporte.
          </p>
        )}
      </div>
    </div>
  );
}
