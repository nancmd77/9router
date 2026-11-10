// hark: catalog policy — members are model × effort with AA numbers.
import { describe, it, expect, beforeEach } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";
import { buildCatalogCriteria, catalogRouteToChoice, orderCatalogFallback, resetStickyComboStore } from "../../open-sse/services/systemoneRouter.js";
import { parseCatalogMember, catalogEntry, dominatedMembers } from "../../open-sse/config/claudeEffortCatalog.js";

const log = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
const E = ["low", "medium", "high", "xhigh", "max"];
const MODELS = [
  "cc/claude-haiku-5-5(xhigh)", "cc/claude-haiku-5-5(max)",
  ...E.map((e) => `cc/claude-sonnet-5-5(${e})`),
  ...E.map((e) => `cc/claude-opus-5-5(${e})`),
  ...E.map((e) => `cc/claude-fable-5-2(${e})`),
];
function ok(content = "ok") {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), clone: make, json: async () => json });
  return make();
}
async function run(body, route, sessionId = "s1") {
  const tried = []; let calls = 0;
  await handleComboChat({
    body, models: MODELS, log, comboName: "ClaudeCombo", comboStrategy: "smart", sessionId,
    smartPolicy: "catalog", confidenceThreshold: 0.5,
    handleSingleModel: async (_b, m) => { tried.push(m); return ok(m); },
    resolveSmartChoice: async () => { calls++; return route; },
  });
  return { tried, calls };
}

describe("catalog data", () => {
  it("parses effort suffix and default", () => {
    expect(parseCatalogMember("cc/claude-opus-5-5(xhigh)")).toMatchObject({ base: "claude-opus-5-5", effort: "xhigh" });
    expect(parseCatalogMember("cc/claude-fable-5-2")).toMatchObject({ effort: "high", explicitEffort: false });
  });
  it("has AA numbers for every member", () => {
    for (const m of MODELS) expect(catalogEntry(m)).not.toBeNull();
    expect(catalogEntry("cc/claude-fable-5-2(max)")).toMatchObject({ index: 65, cost: 26.54 });
  });
  it("describes every member for the decider and flags dominated ones", () => {
    const c = buildCatalogCriteria(MODELS);
    expect(Object.keys(c)).toHaveLength(17);
    expect(c["cc/claude-haiku-5-5(max)"]).toMatch(/Índice AA 36/);
    const dom = dominatedMembers(MODELS);
    expect(dom.has("cc/claude-sonnet-5-5(max)")).toBe(true); // Fable medium: 56 for $3.80
    expect(dom.has("cc/claude-fable-5-2(max)")).toBe(false);
    expect(c["cc/claude-sonnet-5-5(max)"]).toMatch(/por menos/);
  });
});

describe("catalog choice", () => {
  it("confident decider wins", () => {
    expect(catalogRouteToChoice(MODELS, { choice: "cc/claude-haiku-5-5(max)", confidence: 0.7 }).choice).toBe("cc/claude-haiku-5-5(max)");
  });
  it("spread probabilities → cheapest member reaching the expected index", () => {
    const probabilities = { "cc/claude-opus-5-5(xhigh)": 0.3, "cc/claude-fable-5-2(high)": 0.3, "cc/claude-sonnet-5-5(high)": 0.4 };
    const r = catalogRouteToChoice(MODELS, { choice: "cc/claude-sonnet-5-5(high)", confidence: 0.4, probabilities });
    // expected = 0.3*57 + 0.3*62 + 0.4*42 = 52.5 → cheapest with index ≥ 51.5 = Fable low (54, $3.10)
    expect(r.choice).toBe("cc/claude-fable-5-2(low)");
    expect(r.how).toBe("média ponderada");
  });
  it("no answer → Sonnet high (index 42 floor)", () => {
    expect(catalogRouteToChoice(MODELS, null).choice).toBe("cc/claude-sonnet-5-5(high)");
  });
  it("fallback after a Fable choice tries another family first", () => {
    const order = orderCatalogFallback(MODELS, "cc/claude-fable-5-2(high)");
    expect(order[1]).not.toMatch(/fable/);
    expect(order[1]).toBe("cc/claude-opus-5-5(max)");
  });
});

describe("combo catalog policy", () => {
  beforeEach(() => resetStickyComboStore());
  it("routes a greeting to Haiku when the decider says so", async () => {
    const { tried } = await run({ messages: [{ role: "user", content: "Boa tarde" }] }, { choice: "cc/claude-haiku-5-5(xhigh)", confidence: 0.6 });
    expect(tried[0]).toBe("cc/claude-haiku-5-5(xhigh)");
  });
  it("keeps the member through the tool loop", async () => {
    await run({ messages: [{ role: "user", content: "refatora" }] }, { choice: "cc/claude-fable-5-2(xhigh)", confidence: 0.9 });
    const { tried, calls } = await run({ messages: [{ role: "user", content: "refatora" }, { role: "assistant", tool_calls: [{ id: "1" }] }, { role: "tool", content: "r" }] }, { choice: "cc/claude-haiku-5-5(max)", confidence: 0.9 });
    expect(calls).toBe(0);
    expect(tried[0]).toBe("cc/claude-fable-5-2(xhigh)");
  });
});

describe("fable launch promo", () => {
  it("halves Fable cost before the deadline and restores it after", async () => {
    const m = await import("../../open-sse/config/claudeEffortCatalog.js");
    const before = Date.parse("2026-11-10T20:00:00Z");
    const after = Date.parse("2026-11-17T08:00:00Z");
    expect(m.catalogEntry("cc/claude-fable-5-2(low)", before).cost).toBeCloseTo(1.55, 2);
    expect(m.catalogEntry("cc/claude-fable-5-2(low)", after).cost).toBeCloseTo(3.10, 2);
    expect(m.catalogEntry("cc/claude-opus-5-5(high)", before).promo).toBe(false);
  });
});
