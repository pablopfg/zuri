import { AGENT_INSTANCE_NAME } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { testEnv } from "./helpers.ts";

// PR S09: the contacts' sync (every 5 minutes) and the reviews' check (every 10) never read Google in the
// same wake of the one alarm: a check due in a wake that synced the contacts waits two and a half minutes.

const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the alarm's two Google reads", () => {
  it("holds the reviews' check off when the contacts were synced in this wake, before asking whether it is due", async () => {
    await inOwner(async (agent) => {
      const order: string[] = [];
      vi.spyOn(agent.store.contacts, "tick").mockImplementation(async () => {
        order.push("contacts");
        return true;
      });
      vi.spyOn(agent.store.reviews, "holdOff").mockImplementation((ms) => {
        order.push(`hold ${ms}`);
      });
      vi.spyOn(agent.store.reviews, "tick").mockImplementation(async () => {
        order.push("reviews");
        return false;
      });
      await agent.runAutomations(null);
      expect(order).toEqual(["contacts", "hold 150000", "reviews"]);
    });
  });

  it("leaves the reviews' check alone in a wake without a contacts' sync", async () => {
    await inOwner(async (agent) => {
      vi.spyOn(agent.store.contacts, "tick").mockResolvedValue(false);
      const hold = vi.spyOn(agent.store.reviews, "holdOff");
      const check = vi.spyOn(agent.store.reviews, "tick").mockResolvedValue(false);
      await agent.runAutomations(null);
      expect(hold).not.toHaveBeenCalled();
      expect(check).toHaveBeenCalledTimes(1);
    });
  });

  it("still checks the reviews when the contacts' sync throws", async () => {
    await inOwner(async (agent) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(agent.store.contacts, "tick").mockRejectedValue(new Error("boom"));
      const check = vi.spyOn(agent.store.reviews, "tick").mockResolvedValue(false);
      await agent.runAutomations(null);
      expect(check).toHaveBeenCalledTimes(1);
      expect(error.mock.calls.flat().join(" ")).toContain("google_alarm_failed");
    });
  });
});
