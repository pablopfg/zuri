import { describe, expect, it } from "vitest";
import { AGENT_IDS, AGENT_PROFILES, AGENT_TEMPERATURE, defaultAgentSettings } from "../src/agents.ts";

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
