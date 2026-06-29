// ═══════════════════════════════════════════════════════════════════════════
//  Ava V2.1 — Domain Validator (Business Only Mode)
//  Enforces strict business domain boundaries.
//  NO hallucinations, NO general knowledge, NO out-of-domain queries.
// ═══════════════════════════════════════════════════════════════════════════

// ── Out-of-domain keywords (prohibited topics) ───────────────────────────────────────
// These are topics that should ALWAYS be rejected.
function mkPattern(words: string[], flags = "i"): RegExp {
  // Escape regex special chars in each word
  const escaped = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp("\\b(?:" + escaped.join("|") + ")\\b", flags);
}

const POLITICS_RELIGION = mkPattern([
  "política","político","politica","politico","gobierno","elecciones","partido","voto",
  "presidente","ministro","congreso","parlamento","religión","religion","cristiano","cristiana",
  "islam","islamismo","judío","judio","católico","catolico","protestante","bautista","evangélico",
  "budista","hinduismo","hindúismo","ateo","atea","iglesia","templo","mezquita","sinagoga",
  "dios","biblia","corán","coran","toráh","torah",
]);

const SPORTS = mkPattern([
  "fútbol","futbol","baloncesto","basket","tenis","golf","natación","natacion","atletismo",
  "ciclismo","motor","fórmula","formula","moto","maratón","maraton","triatlón","triatlon",
  "olimpiada","juegos olímpicos","mundial","champion","liga","nba","nfl","mlb","fifa","uefa",
  "ufc","boxeo","lucha","deporte","deportista","equipo","entrenador","jugador","partido","gol",
  "canasta","set",
]);

const NEWS_CULTURE = mkPattern([
  "noticias","noticia","actualidad","periódico","periodico","diario","revista","noticiero",
  "informativo","prensa","televisión","television","programa","serie","película","pelicula",
  "cine","netflix","hbo","disney","spotify","música","musica","cantante","banda","grupo",
  "concierto","festival","gira","historia","histórico","historico","edad","siglo","imperio",
  "guerra","batalla","revolución","revolucion","colonia","independencia","reinado","dinastía",
  "monarquía","república","democracia","dictadura","arte","artista","pintor","escultor",
  "arquitecto","museo","galería","exposición","exposicion","cuadro","escultura","literatura",
  "novela","poeta","poema","poesía","poesia","cuento","teatro","drama","comedia","tragedia",
  "actriz","actor","director","escenario","bailarín","bailarin","danza","opera","ballet",
  "filosofía","filosofia","filósofo","filosofo","ética","etica","moral","moralidad","valores",
  "principios","creencia","ideología","ideologia","doctrina","dogma","cosmología","cosmologia",
  "metafísica","metafisica","epistemología","epistemologia","ontología","ontologia",
  "existencia","conciencia","mente","pensamiento","razón","razon","lógica","logica","argumento",
  "razonamiento","lenguaje","lengua","idioma","comunicación","comunicacion","expresión",
  "expresion","significado","semántica","semantica","pragmática","pragmatica","sintaxis",
  "gramática","gramatica","morfológica","morfológica","fonética","fonetica","fonología",
  "fonologia","lexicología","lexicologia","etimología","etimologia",
]);

const OUT_OF_DOMAIN_PATTERNS: RegExp[] = [
  POLITICS_RELIGION,
  SPORTS,
  NEWS_CULTURE,
];

// ── Public API ─────────────────────────────────────────────────────────────────

export function isOutOfDomain(text: string): boolean {
  return OUT_OF_DOMAIN_PATTERNS.some(p => p.test(text));
}

export function domainValidatorResponse(): string {
  return (
    "Lo siento, solo puedo ayudarte con temas de negocio, CRM, ventas, " +
    "contabilidad, productividad y operaciones de tu empresa. " +
    "Para otros temas te sugiero consultar fuentes especializadas."
  );
}
