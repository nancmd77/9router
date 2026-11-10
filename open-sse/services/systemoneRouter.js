/**
 * Pure System One router utilities for intelligent combo model selection.
 * Used by the "smart" combo strategy to pick the best model for a request
 * before generation begins, with session stickiness for prompt-cache retention.
 */

import { catalogEntry, describeCatalogMember, dominatedMembers, CATALOG_SOURCE } from "../config/claudeEffortCatalog.js";

export const DEFAULT_SYSTEMONE_ROUTER_MODEL = "oc/jev-1.13-free";
export const DEFAULT_SYSTEMONE_TIMEOUT_MS = 8000;
export const MAX_STATE_CHARS = 2000;
export const MAX_STICKY_SESSIONS = 5000;
export const STICKY_SESSION_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

/**
 * In-memory session stickiness store for smart-routed combos.
 * Key: `${comboName}:${sessionId}` -> Value: { model, lastUsed }
 */
const comboSessionModelStore = new Map();

/**
 * Extract prompt text from the request body for System One classification.
 * Takes the last user turn (or prompt) and truncates to avoid token waste.
 *
 * @param {object} body - Request body
 * @param {number} [maxChars=MAX_STATE_CHARS] - Max character cap
 * @returns {string} Clean prompt state
 */
export function extractPromptState(body, maxChars = MAX_STATE_CHARS) {
  if (!body || typeof body !== "object") return "";

  // Messages array (OpenAI / Claude / etc.) or input array (Codex)
  const messages = Array.isArray(body.messages)
    ? body.messages
    : (Array.isArray(body.input) ? body.input : null);

  if (messages && messages.length > 0) {
    // Find the latest user message
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg?.role === "user" || msg?.type === "message" || (!msg?.role && msg?.content)) {
        const text = extractTextFromContent(msg.content ?? msg.text);
        if (text && text.trim().length > 0) {
          return text.trim().slice(0, maxChars);
        }
      }
    }
    // Fallback: latest message of any role
    const lastMsg = messages[messages.length - 1];
    const text = extractTextFromContent(lastMsg?.content ?? lastMsg?.text);
    if (text) return text.trim().slice(0, maxChars);
  }

  // String prompt / input
  if (typeof body.prompt === "string" && body.prompt.trim()) {
    return body.prompt.trim().slice(0, maxChars);
  }
  if (typeof body.input === "string" && body.input.trim()) {
    return body.input.trim().slice(0, maxChars);
  }

  return "";
}

function extractTextFromContent(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") return part;
        if (part?.type === "text" && typeof part.text === "string") return part.text;
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

/**
 * Build choice criteria dictionary for System One from an array of models.
 * Criteria keys are the model names; values are null so System One uses its
 * native knowledge of models without manual descriptions.
 *
 * @param {string[]} models - Array of model IDs in the combo
 * @returns {Record<string, null>} Criteria map
 */
export function buildChoiceCriteria(models) {
  const criteria = {};
  if (!Array.isArray(models)) return criteria;
  for (const m of models) {
    if (typeof m === "string" && m.trim().length > 0) {
      criteria[m.trim()] = null;
    }
  }
  return criteria;
}

/**
 * Parse a System One route response JSON.
 *
 * @param {object} json - Upstream response payload
 * @returns {{ choice: string, confidence: number|null, probabilities: Record<string, number>|null } | null}
 */
export function parseSystemOneRouteAnswer(json) {
  if (!json || typeof json !== "object") return null;

  const route = json.answers?.route;
  if (!route || typeof route !== "object") return null;

  const rawChoice = typeof route.choice === "string" ? route.choice.trim() : "";
  if (!rawChoice) return null;

  const confidence = typeof route.confidence === "number" && Number.isFinite(route.confidence)
    ? route.confidence
    : null;

  let probabilities = null;
  if (route.probabilities && typeof route.probabilities === "object" && !Array.isArray(route.probabilities)) {
    probabilities = {};
    for (const [k, v] of Object.entries(route.probabilities)) {
      const num = typeof v === "number" ? v : Number(v);
      if (Number.isFinite(num)) {
        probabilities[k] = num;
      }
    }
  }

  return {
    choice: rawChoice,
    confidence,
    probabilities,
  };
}

/**
 * Order combo models based on System One choice result:
 * 1. The selected choice is placed at index 0.
 * 2. Remaining models are ordered by probabilities descending.
 * 3. Models without probabilities retain their relative order at the end.
 *
 * @param {string[]} models - Original models array
 * @param {object} choiceResult - Parsed System One choice
 * @returns {string[]} Reordered models array
 */
export function orderModelsByChoice(models, choiceResult) {
  if (!Array.isArray(models) || models.length <= 1) return models || [];
  if (!choiceResult?.choice || !models.includes(choiceResult.choice)) return [...models];

  const { choice, probabilities } = choiceResult;
  const others = models.filter((m) => m !== choice);

  if (probabilities && typeof probabilities === "object") {
    others.sort((a, b) => {
      const pA = probabilities[a] ?? 0;
      const pB = probabilities[b] ?? 0;
      return pB - pA;
    });
  }

  return [choice, ...others];
}

/**
 * Check if a session already has a sticky model assigned for this combo.
 *
 * @param {string} comboName - Combo name
 * @param {string|null} sessionId - Client session identifier
 * @param {string[]} models - Currently available combo models
 * @returns {string|null} Model to use, or null if no sticky model
 */
export function getStickyComboModel(comboName, sessionId, models) {
  if (!sessionId || !comboName || !Array.isArray(models)) return null;

  const key = `${comboName}:${sessionId}`;
  const entry = comboSessionModelStore.get(key);
  if (!entry) return null;

  // Check TTL (2 hours)
  if (Date.now() - entry.lastUsed > STICKY_SESSION_TTL_MS) {
    comboSessionModelStore.delete(key);
    return null;
  }

  // Ensure stored model still belongs to combo
  if (!models.includes(entry.model)) {
    comboSessionModelStore.delete(key);
    return null;
  }

  entry.lastUsed = Date.now();
  return entry.model;
}

/**
 * Record sticky model for this session so subsequent turns keep prompt-cache warm.
 *
 * @param {string} comboName - Combo name
 * @param {string|null} sessionId - Client session identifier
 * @param {string} model - Selected model
 */
export function setStickyComboModel(comboName, sessionId, model) {
  if (!sessionId || !comboName || !model) return;

  pruneStickyComboSessions();
  const key = `${comboName}:${sessionId}`;
  comboSessionModelStore.set(key, { model, lastUsed: Date.now() });
}

/**
 * Clear a sticky session mapping (e.g. after a model fails or resets).
 *
 * @param {string} comboName - Combo name
 * @param {string|null} [sessionId] - Specific session ID; omit to clear all for combo
 */
export function clearStickyComboSession(comboName, sessionId = null) {
  if (!comboName) {
    comboSessionModelStore.clear();
    return;
  }
  if (sessionId) {
    comboSessionModelStore.delete(`${comboName}:${sessionId}`);
    return;
  }
  // Clear all for this combo
  const prefix = `${comboName}:`;
  for (const k of comboSessionModelStore.keys()) {
    if (k.startsWith(prefix)) comboSessionModelStore.delete(k);
  }
}

/**
 * Prune old or excess sticky sessions to prevent unbounded memory growth.
 */
export function pruneStickyComboSessions() {
  if (comboSessionModelStore.size < MAX_STICKY_SESSIONS) return;

  const now = Date.now();
  // Remove expired
  for (const [k, v] of comboSessionModelStore.entries()) {
    if (now - v.lastUsed > STICKY_SESSION_TTL_MS) {
      comboSessionModelStore.delete(k);
    }
  }

  // If still above ceiling, drop oldest entries
  if (comboSessionModelStore.size >= MAX_STICKY_SESSIONS) {
    const sorted = [...comboSessionModelStore.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    const toDrop = sorted.slice(0, Math.floor(MAX_STICKY_SESSIONS / 4));
    for (const [k] of toDrop) {
      comboSessionModelStore.delete(k);
    }
  }
}

/**
 * Reset sticky store (for testing).
 */
export function resetStickyComboStore() {
  comboSessionModelStore.clear();
}

// ─── Complexity routing (hark) ──────────────────────────────────────────────
// Instead of asking the router "which of these model ids fits" (it only sees bare
// ids and spreads its probability across them), ask it how complex the latest
// request is, then map the tier onto the combo's own members.

export const COMPLEXITY_TIERS = ["simples", "normal", "pesado"];

export const COMPLEXITY_CRITERIA = {
  simples: "Conversa ou saudação, pergunta curta de fato, confirmação, ajuste pequeno, ação de um passo, resumo curto. Não exige raciocínio longo nem código novo.",
  normal: "Tarefa com alguns passos: escrever ou corrigir um trecho de código, pesquisar e resumir, montar um texto médio, usar algumas ferramentas, seguir um procedimento conhecido.",
  pesado: "Problema difícil ou crítico: arquitetura, depuração difícil, refatoração grande, plano longo com muitas etapas, análise profunda, decisão difícil de desfazer, produção ou dados importantes.",
};

const TIER_PATTERNS = [
  ["pesado", /(opus|fable|ultra|-pro\b|pro-|\bo[13]\b|gpt-\d[\d.]*-sol|argon-high|thinking|reasoner)/i],
  ["simples", /(haiku|mini|nano|lite|small|flash-low|8b|9b|mercury)/i],
  ["normal", /(sonnet|flash|medium|gpt|qwen|deepseek|gemini|oss)/i],
];

/** Tier of a combo member, guessed from its id. Unknown ids are "normal". */
export function modelTier(model) {
  const id = String(model || "");
  for (const [tier, re] of TIER_PATTERNS) if (re.test(id)) return tier;
  return "normal";
}

/** Combo members of one tier, in combo order. */
export function membersOfTier(models, tier) {
  return (models || []).filter((m) => modelTier(m) === tier);
}

/**
 * Order the combo for a complexity tier: the tier's members first (combo order),
 * then the next tiers up (more capable) and finally the ones below.
 */
export function orderModelsByTier(models, tier) {
  const idx = COMPLEXITY_TIERS.indexOf(tier);
  const order = idx < 0 ? COMPLEXITY_TIERS : [
    tier,
    ...COMPLEXITY_TIERS.slice(idx + 1),
    ...COMPLEXITY_TIERS.slice(0, idx).reverse(),
  ];
  const out = [];
  for (const t of order) for (const m of membersOfTier(models, t)) if (!out.includes(m)) out.push(m);
  for (const m of models || []) if (!out.includes(m)) out.push(m);
  return out;
}

/** Turn the router's tier answer into { tier, choice, confidence, probabilities }. */
export function tierRouteToChoice(models, route, { threshold = 0.5, fallbackTier = "normal" } = {}) {
  if (!route) return null;
  const tier = COMPLEXITY_TIERS.includes(route.choice) ? route.choice : null;
  const conf = typeof route.confidence === "number" ? route.confidence : null;
  let finalTier = tier && (conf === null || conf >= threshold) ? tier : fallbackTier;
  // A tier with no member in this combo: move to the nearest tier that has one.
  if (membersOfTier(models, finalTier).length === 0) {
    const ordered = orderModelsByTier(models, finalTier);
    finalTier = modelTier(ordered[0]);
  }
  const ordered = orderModelsByTier(models, finalTier);
  return { tier: finalTier, routerTier: tier, choice: ordered[0], ordered, confidence: conf, probabilities: route.probabilities || null };
}

/**
 * True when the request continues a turn already in progress (the last message is a
 * tool result or an assistant tool call), not a new message from the user.
 */
export function isToolContinuation(body) {
  const msgs = Array.isArray(body?.messages) ? body.messages : (Array.isArray(body?.input) ? body.input : null);
  if (!msgs || msgs.length === 0) return false;
  const last = msgs[msgs.length - 1];
  if (!last) return false;
  if (last.role === "tool" || last.type === "function_call_output") return true;
  if (last.role === "assistant" && Array.isArray(last.tool_calls) && last.tool_calls.length) return true;
  if (last.role === "user" && Array.isArray(last.content) && last.content.length > 0
      && last.content.every((p) => p?.type === "tool_result")) return true;
  return false;
}

// ─── Catalog routing (hark) ─────────────────────────────────────────────────
// Every combo member is a model × effort described with its Artificial Analysis
// numbers. The decider picks one; when it is unsure, the probability-weighted
// expected index picks the cheapest member that reaches it.


export const CATALOG_INSTRUCTIONS =
  "Escolha a opção que vai fazer ESTA última mensagem do usuário bem feita gastando o mínimo: a mais barata e rápida que dá conta. " +
  "Conversa, saudação e pergunta simples não precisam de modelo forte. Suba de nível só quando a tarefa exige (código grande, depuração, plano longo, análise profunda, risco alto). " +
  `Os números vêm do ${CATALOG_SOURCE}: índice maior é mais capaz, custo e minutos maiores são piores.`;

/** Criteria map for the decider: member id → description (falls back to the id). */
export function buildCatalogCriteria(models) {
  const dominated = dominatedMembers(models);
  const criteria = {};
  for (const m of models || []) {
    if (typeof m !== "string" || !m.trim()) continue;
    const d = describeCatalogMember(m);
    criteria[m] = d
      ? (dominated.has(m) ? `${d} Atenção: outra opção desta lista faz o mesmo ou melhor por menos.` : d)
      : `Modelo ${m}.`;
  }
  return criteria;
}

/** Fallback order after `choice`: other families first (a refusal is per model), nearest index first. */
export function orderCatalogFallback(models, choice) {
  const c = catalogEntry(choice);
  const rest = (models || []).filter((m) => m !== choice);
  if (!c) return [choice, ...rest];
  const key = (m) => {
    const e = catalogEntry(m);
    if (!e) return [2, 999];
    const sameFamily = e.base === c.base ? 1 : 0;
    // prefer stronger-or-equal (small penalty below), nearest index first
    const dist = e.index >= c.index ? e.index - c.index : (c.index - e.index) + 0.5;
    return [sameFamily, dist];
  };
  rest.sort((a, b) => { const ka = key(a), kb = key(b); return ka[0] - kb[0] || ka[1] - kb[1]; });
  return [choice, ...rest];
}

/** Cheapest member whose index reaches `target` (or the strongest when none does). */
export function cheapestReaching(models, target) {
  const entries = (models || []).map(catalogEntry).filter(Boolean);
  if (!entries.length) return null;
  const ok = entries.filter((e) => e.index >= target).sort((a, b) => a.cost - b.cost);
  return (ok[0] || entries.sort((a, b) => b.index - a.index)[0]).model;
}

/**
 * Decide the member from the decider's answer:
 * - top probability ≥ threshold → that member;
 * - else probability-weighted expected index → cheapest member reaching it;
 * - no answer → `fallbackModel` (or the cheapest member reaching index 42, roughly Sonnet high).
 */
export function catalogRouteToChoice(models, route, { threshold = 0.5, fallbackModel = null } = {}) {
  const known = (models || []).filter((m) => catalogEntry(m));
  let choice = null, how = "sem resposta", expected = null;
  const conf = typeof route?.confidence === "number" ? route.confidence : null;
  if (route?.choice && models.includes(route.choice) && (conf === null || conf >= threshold)) {
    choice = route.choice; how = "decider";
  } else if (route?.probabilities && known.length) {
    let sum = 0, acc = 0;
    for (const m of known) {
      const p = Number(route.probabilities[m]) || 0;
      sum += p; acc += p * catalogEntry(m).index;
    }
    if (sum > 0) {
      expected = acc / sum;
      choice = cheapestReaching(known, expected - 1);
      how = "média ponderada";
    }
  }
  if (!choice && route?.choice && models.includes(route.choice)) { choice = route.choice; how = "decider (confiança baixa)"; }
  if (!choice) {
    choice = (fallbackModel && models.includes(fallbackModel)) ? fallbackModel : (cheapestReaching(known, 42) || models[0]);
    how = how === "sem resposta" ? "padrão" : how;
  }
  return { choice, how, expected, confidence: conf, ordered: orderCatalogFallback(models, choice) };
}
