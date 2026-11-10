// hark: catalog of Claude models × effort for the "catalog" combo policy.
// Numbers: Artificial Analysis Intelligence Index v5.0.1, read 2026-11-10 from
// https://artificialanalysis.ai/models/<model>-<effort> (max = the bare model page).
// index = AA score; cost = USD per index task at API list price; minutes = time per task.
// On a Claude Code subscription the "cost" is quota use, not a bill: still a fair
// measure of how much of the limit an option burns.

export const CATALOG_SOURCE = "Artificial Analysis Intelligence Index v5.0.1 (2026-11-10)";

const FAMILY = {
  "claude-haiku-5-5": {
    name: "Haiku 5.5",
    blurb: "o menor e mais barato da família. Bom para conversa, saudação, perguntas curtas, resumos, classificação, extração e passos simples com ferramentas. Fraco em código grande, depuração difícil e conhecimento factual raro",
  },
  "claude-sonnet-5-5": {
    name: "Sonnet 5.5",
    blurb: "modelo médio, forte em código e uso de terminal (Terminal-Bench 4.0 64% no max), mas gasta muitos tokens; abaixo do Opus em conhecimento factual e raciocínio científico",
  },
  "claude-opus-5-5": {
    name: "Opus 5.5",
    blurb: "modelo grande, melhor que Sonnet em conhecimento, raciocínio e trabalho de escritório com documentos (AA-Briefcase, GDPval); bom em agente e terminal",
  },
  "claude-fable-5-2": {
    name: "Fable 5.2",
    blurb: "o mais forte disponível (1º no índice AA). Ideal para arquitetura, depuração difícil, refatoração grande, planos longos e análise profunda. Mais caro por token ($8/$40) e o mais lento; os classificadores de segurança dele recusam alguns temas de segurança/cyber",
  },
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

function fmtUsd(n) { return n < 1 ? n.toFixed(2).replace(".", ",") : n.toFixed(2).replace(".", ","); }

/** Plain-language description the decider reads for one member. */
export function describeCatalogMember(model) {
  const e = catalogEntry(model);
  if (!e) return null;
  const fam = FAMILY[e.base];
  return `${e.family}, ${EFFORT[e.effort]}. ${fam.blurb}. Índice AA ${e.index} (escala de 19 a 65 entre estas opções), cerca de US$ ${fmtUsd(e.cost)} e ${String(e.minutes).replace(".", ",")} min por tarefa de benchmark.`;
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
