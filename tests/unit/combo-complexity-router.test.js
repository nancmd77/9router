// hark: complexity routing — classify each new user message (simples / normal / pesado)
// and send it to that tier's combo member; tool loops keep the member.
import { describe, it, expect, beforeEach } from "vitest";
import { handleComboChat } from "../../open-sse/services/combo.js";
import {
  modelTier, orderModelsByTier, tierRouteToChoice, isToolContinuation, resetStickyComboStore,
} from "../../open-sse/services/systemoneRouter.js";

const log = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
const MODELS = ["cc/claude-fable-5-2", "cc/claude-haiku-5-5(max)", "cc/claude-sonnet-5-5", "cc/claude-opus-5-5"];
function ok(content = "ok") {
  const json = { choices: [{ message: { role: "assistant", content } }] };
  const make = () => ({ ok: true, status: 200, headers: new Headers({ "content-type": "application/json" }), clone: make, json: async () => json });
  return make();
}
async function run({ body, route, sessionId = "s1", comboName = "ClaudeCombo", threshold = 0.5 }) {
  const tried = []; let calls = 0;
  await handleComboChat({
    body, models: MODELS, log, comboName, comboStrategy: "smart", sessionId,
    smartPolicy: "complexity", confidenceThreshold: threshold,
    handleSingleModel: async (_b, m) => { tried.push(m); return ok(m); },
    resolveSmartChoice: async () => { calls++; return route; },
  });
  return { tried, calls };
}

describe("tiers", () => {
  it("maps Claude ids", () => {
    expect(modelTier("cc/claude-haiku-5-5(max)")).toBe("simples");
    expect(modelTier("cc/claude-sonnet-5-5")).toBe("normal");
    expect(modelTier("cc/claude-opus-5-5")).toBe("pesado");
    expect(modelTier("cc/claude-fable-5-2")).toBe("pesado");
  });
  it("orders tier first, then up, then down", () => {
    expect(orderModelsByTier(MODELS, "simples")).toEqual(["cc/claude-haiku-5-5(max)", "cc/claude-sonnet-5-5", "cc/claude-fable-5-2", "cc/claude-opus-5-5"]);
    expect(orderModelsByTier(MODELS, "normal")).toEqual(["cc/claude-sonnet-5-5", "cc/claude-fable-5-2", "cc/claude-opus-5-5", "cc/claude-haiku-5-5(max)"]);
    expect(orderModelsByTier(MODELS, "pesado")[0]).toBe("cc/claude-fable-5-2");
  });
  it("low confidence goes to normal", () => {
    expect(tierRouteToChoice(MODELS, { choice: "pesado", confidence: 0.2 }, { threshold: 0.5 }).choice).toBe("cc/claude-sonnet-5-5");
  });
  it("detects tool continuations", () => {
    expect(isToolContinuation({ messages: [{ role: "user", content: "x" }] })).toBe(false);
    expect(isToolContinuation({ messages: [{ role: "user", content: "x" }, { role: "assistant", tool_calls: [{ id: "1" }] }, { role: "tool", content: "r" }] })).toBe(true);
    expect(isToolContinuation({ messages: [{ role: "user", content: [{ type: "tool_result", content: "r" }] }] })).toBe(true);
  });
});

describe("combo complexity policy", () => {
  beforeEach(() => resetStickyComboStore());
  it("simple message → Haiku", async () => {
    const { tried } = await run({ body: { messages: [{ role: "user", content: "Boa tarde" }] }, route: { choice: "simples", confidence: 0.9 } });
    expect(tried[0]).toBe("cc/claude-haiku-5-5(max)");
  });
  it("heavy message → Fable", async () => {
    const { tried } = await run({ body: { messages: [{ role: "user", content: "refatora a arquitetura" }] }, route: { choice: "pesado", confidence: 0.8 } });
    expect(tried[0]).toBe("cc/claude-fable-5-2");
  });
  it("router failure → normal tier", async () => {
    const { tried } = await run({ body: { messages: [{ role: "user", content: "x" }] }, route: null });
    expect(tried[0]).toBe("cc/claude-sonnet-5-5");
  });
  it("tool loop keeps the chosen member without calling the router", async () => {
    await run({ body: { messages: [{ role: "user", content: "faz" }] }, route: { choice: "pesado", confidence: 0.9 } });
    const loop = { messages: [{ role: "user", content: "faz" }, { role: "assistant", tool_calls: [{ id: "1" }] }, { role: "tool", content: "r" }] };
    const { tried, calls } = await run({ body: loop, route: { choice: "simples", confidence: 0.99 } });
    expect(calls).toBe(0);
    expect(tried[0]).toBe("cc/claude-fable-5-2");
  });
  it("next user message is re-classified", async () => {
    await run({ body: { messages: [{ role: "user", content: "faz" }] }, route: { choice: "pesado", confidence: 0.9 } });
    const { tried, calls } = await run({ body: { messages: [{ role: "user", content: "faz" }, { role: "assistant", content: "feito" }, { role: "user", content: "valeu" }] }, route: { choice: "simples", confidence: 0.9 } });
    expect(calls).toBe(1);
    expect(tried[0]).toBe("cc/claude-haiku-5-5(max)");
  });
});
