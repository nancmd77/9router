// hark: catalog of Claude models × effort for the "catalog" combo policy.
// Numbers: Artificial Analysis Intelligence Index v5.0.1, read 2026-11-10 from
// https://artificialanalysis.ai/models/<model>-<effort> (max = the bare model page).
// index = AA score; cost = USD per index task at API list price; minutes = time per task.
// On a Claude Code subscription the "cost" is quota use, not a bill: still a fair
// measure of how much of the limit an option burns.

// Sub-scores (Terminal-Bench 4.0, GDPval-AA, AA-Omniscience accuracy) and the usage
// notes come from the OpenRouter model pages (openrouter.ai/anthropic/<model>), read
// 2026-11-10; they are Artificial Analysis runs of the earlier index version.
export const CATALOG_SOURCE = "Artificial Analysis Intelligence Index v5.0.1 e páginas do OpenRouter (2026-11-10)";

const FAMILY = {
  "claude-haiku-5-5": {
    name: "Haiku 5.5",
    blurb: "o menor, mais barato e mais rápido. Feito para trabalho de alto volume: conversa, saudação, perguntas curtas, resumos, classificação, extração, subagentes e uso de navegador. Pouco conhecimento factual raro, mas admite quando não sabe. Fraco em código grande e depuração difícil",
  },
  "claude-sonnet-5-5": {
    name: "Sonnet 5.5",
    blurb: "para trabalho do dia a dia bem delimitado: criar funcionalidades, corrigir bugs, documentos, slides e planilhas bem acabados, texto claro. Forte em terminal no effort alto, mas gasta muitos tokens; abaixo do Opus em conhecimento factual e ciência",
  },
  "claude-opus-5-5": {
    name: "Opus 5.5",
    blurb: "o modelo principal recomendado pela Anthropic para a maior parte do código e do trabalho intelectual: mudanças em vários passos em bases de código grandes, revisão de código e caça a bugs, análise financeira e científica, leitura de gráficos e prints. Mais conhecimento factual que Sonnet e Haiku; resolve em menos passos",
  },
  "claude-fable-5-2": {
    name: "Fable 5.2",
    blurb: "o mais capaz (1º no índice AA), para os problemas mais ambiciosos e abertos: migrações grandes, arquitetura, depuração muito difícil, pesquisa de ponta. A Anthropic recomenda o Opus 5.5 no dia a dia e o Fable só para o que o Opus não resolve. O mais caro por token ($8/$40) e o mais lento; os classificadores dele recusam alguns temas de segurança/cyber",
  },
};

// [Terminal-Bench 4.0, GDPval-AA, AA-Omniscience accuracy] in % (OpenRouter pages).
export const CLAUDE_EFFORT_SUBSCORES = {
  "claude-haiku-5-5": { low: [12.6, 31.5, 30.4], medium: [15.2, 39.1, 31.7], high: [21.7, 46.2, 31.8], xhigh: [29.3, 51.1, 33.8], max: [32.8, 56.4, 34.7] },
  "claude-sonnet-5-5": { low: [20.7, 34.1, 46.0], medium: [29.8, 41.4, 45.8], high: [43.9, 52.8, 50.3], xhigh: [57.1, 61.8, 50.9], max: [63.6, 66.9, 51.5] },
  "claude-opus-5-5": { low: [31.3, 37.0, 63.3], medium: [52.5, 54.6, 63.9], high: [56.6, 60.7, 64.8], xhigh: [59.6, 66.8, 65.5], max: [59.6, 68.3, 65.5] },
  "claude-fable-5-2": { max: [null, 66.6, 79.1] },
};

const EFFORT = {
  low: "effort low: pensa pouco, responde rápido",
  medium: "effort medium: equilíbrio entre rapidez e cuidado",
  high: "effort high: pensa bastante antes de agir",
  xhigh: "effort xhigh: raciocínio longo, para problemas difíceis",
  max: "effort max: raciocínio máximo, lento e caro",
};

// [index, costUsdPerTask, minutesPerTask]
export const CLAUDE_EFFORT_SCORES = {
  "claude-haiku-5-5": { low: [19, 0.04, 2.2], medium: [25, 0.09, 4.0], high: [30, 0.16, 6.5], xhigh: [35, 0.25, 9.6], max: [36, 0.41, 14.8] },
  "claude-sonnet-5-5": { low: [26, 0.51, 2.6], medium: [31, 0.78, 3.6], high: [42, 1.64, 7.0], xhigh: [50, 4.09, 15.0], max: [55, 10.02, 31.4] },
  "claude-opus-5-5": { low: [35, 0.98, 3.0], medium: [48, 2.45, 7.1], high: [52, 3.46, 9.5], xhigh: [57, 6.05, 16.2], max: [59, 10.04, 25.1] },
  "claude-fable-5-2": { low: [54, 3.10, 6.5], medium: [56, 3.80, 8.1], high: [62, 9.08, 17.5], xhigh: [62, 14.83, 26.1], max: [65, 26.54, 44.4] },
};

// Effort Anthropic applies when the id carries none (API default).
const DEFAULT_EFFORT = "high";
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

/** "cc/claude-sonnet-5-5(high)" → { base: "claude-sonnet-5-5", effort: "high" } */
export function parseCatalogMember(model) {
  const s = String(model || "");
  const m = /\(([^()]+)\)\s*$/.exec(s);
  const effortRaw = m ? m[1].trim().toLowerCase() : null;
  const clean = s.replace(/\([^()]+\)\s*$/, "").trim();
  const base = clean.includes("/") ? clean.split("/").pop() : clean;
  const effort = EFFORTS.includes(effortRaw) ? effortRaw : DEFAULT_EFFORT;
  return { base, effort, explicitEffort: !!effortRaw };
}

/** Catalog entry for a combo member, or null when the model is not in the catalog. */
export function catalogEntry(model) {
  const { base, effort } = parseCatalogMember(model);
  const row = CLAUDE_EFFORT_SCORES[base]?.[effort];
  if (!row) return null;
  const [index, cost, minutes] = row;
  return { model, base, effort, family: FAMILY[base]?.name || base, index, cost, minutes };
}

const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);
function fmtUsd(n) { return n < 1 ? n.toFixed(2).replace(".", ",") : n.toFixed(2).replace(".", ","); }

/** Plain-language description the decider reads for one member. */
export function describeCatalogMember(model) {
  const e = catalogEntry(model);
  if (!e) return null;
  const fam = FAMILY[e.base];
  const sub = CLAUDE_EFFORT_SUBSCORES[e.base]?.[e.effort];
  const pct = (v) => `${String(v).replace(".", ",")}%`;
  const subTxt = sub
    ? " " + cap([sub[0] != null ? `código e terminal ${pct(sub[0])}` : null, `trabalho de escritório ${pct(sub[1])}`, `conhecimento factual ${pct(sub[2])}`].filter(Boolean).join(", ")) + "."
    : "";
  return `${e.family}, ${EFFORT[e.effort]}. ${cap(fam.blurb)}. Índice AA ${e.index} (escala de 19 a 65 entre estas opções), cerca de US$ ${fmtUsd(e.cost)} e ${String(e.minutes).replace(".", ",")} min por tarefa de benchmark.${subTxt}`;
}

/** Members of `models` dominated by another member (same or higher index for less cost). */
export function dominatedMembers(models) {
  const entries = models.map(catalogEntry).filter(Boolean);
  const out = new Set();
  for (const a of entries) {
    for (const b of entries) {
      if (a === b) continue;
      if (b.index >= a.index && b.cost < a.cost) { out.add(a.model); break; }
    }
  }
  return out;
}
