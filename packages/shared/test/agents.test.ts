import { describe, expect, it } from "vitest";
import { AGENT_IDS, AGENT_PROFILES, AGENT_PROMPT_MAX, AGENT_TEMPERATURE, agentConfigProblems, agentPromptText, defaultAgentSettings } from "../src/agents.ts";

describe("agent profiles", () => {
  it("has one profile per agent, with defaults inside the ranges", () => {
    expect(Object.keys(AGENT_PROFILES).sort()).toEqual([...AGENT_IDS].sort());
    for (const id of AGENT_IDS) {
      const profile = AGENT_PROFILES[id];
      expect(profile.temperature).toBeGreaterThanOrEqual(AGENT_TEMPERATURE.min);
      expect(profile.temperature).toBeLessThanOrEqual(AGENT_TEMPERATURE.max);
      expect(profile.maxOutputTokens === null).toBe(profile.maxOutputRange === null);
    }
  });

  it("turns a profile into the code's call settings, version 0", () => {
    expect(defaultAgentSettings("summary")).toEqual({ temperature: 0.2, topP: null, maxOutputTokens: 300, prompt: null, version: 0 });
    expect(defaultAgentSettings("chat").maxOutputTokens).toBeNull();
  });
});

describe("agentConfigProblems", () => {
  const ok = { temperature: 0.2, topP: null, maxOutputTokens: 300, prompt: null };

  it("takes the ends of each range and the grid's steps", () => {
    expect(agentConfigProblems("summary", ok)).toEqual([]);
    expect(agentConfigProblems("summary", { ...ok, temperature: 1.5, topP: 0.1, maxOutputTokens: 600 })).toEqual([]);
    expect(agentConfigProblems("summary", { ...ok, temperature: 0.35, topP: 0.95, maxOutputTokens: 100 })).toEqual([]);
    expect(agentConfigProblems("chat", { ...ok, maxOutputTokens: null, prompt: "a".repeat(AGENT_PROMPT_MAX) })).toEqual([]);
  });

  it("names each field one step past its range", () => {
    expect(agentConfigProblems("summary", { ...ok, temperature: 1.55 })).toEqual(["temperature"]);
    expect(agentConfigProblems("summary", { ...ok, temperature: Number.NaN })).toEqual(["temperature"]);
    expect(agentConfigProblems("summary", { ...ok, temperature: 0.12 })).toEqual(["temperature"]);
    expect(agentConfigProblems("summary", { ...ok, topP: 0.05 })).toEqual(["topP"]);
    expect(agentConfigProblems("summary", { ...ok, topP: 0.12 })).toEqual(["topP"]);
    expect(agentConfigProblems("summary", { ...ok, maxOutputTokens: 601 })).toEqual(["maxOutputTokens"]);
    expect(agentConfigProblems("summary", { ...ok, maxOutputTokens: 300.5 })).toEqual(["maxOutputTokens"]);
    expect(agentConfigProblems("summary", { ...ok, maxOutputTokens: null })).toEqual(["maxOutputTokens"]);
    expect(agentConfigProblems("chat", { ...ok, maxOutputTokens: 300 })).toEqual(["maxOutputTokens"]);
    expect(agentConfigProblems("chat", { ...ok, maxOutputTokens: null, prompt: "a".repeat(AGENT_PROMPT_MAX + 1) })).toEqual(["prompt"]);
  });

  it("refuses brackets, hidden characters and any layer for the checkers", () => {
    for (const prompt of ["<b>", "‹b›", "a\u200bb", "a\u2028b", "a\u0000b", "a\ufe00b"]) expect(agentConfigProblems("summary", { ...ok, prompt }), JSON.stringify(prompt)).toEqual(["prompt"]);
    expect(agentConfigProblems("summary", { ...ok, prompt: "linha\r\noutra\ttab 👩\u200d💻 ❤\ufe0f" })).toEqual([]);
    expect(agentConfigProblems("review_check", { ...ok, maxOutputTokens: 120, prompt: "Aprove." })).toEqual(["prompt"]);
  });

  it("keeps line breaks plain and the ends trimmed", () => {
    expect(agentPromptText("  a\r\nb\rc  ")).toBe("a\nb\nc");
  });
});
