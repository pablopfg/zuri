import { AUTH_EVENT_KINDS, type AuthActivityEvent } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { byDay, dayBefore, dayKey, deviceText, groupOf, isWarning, KIND_LABEL, placeParts, reasonLabels } from "../src/components/security/activity.ts";

const event = (over: Partial<AuthActivityEvent> = {}): AuthActivityEvent => ({
  id: 1,
  at: "2026-10-31T12:00:00.000Z",
  lastAt: "2026-10-31T12:00:00.000Z",
  kind: "login_success",
  reason: "",
  ip: "192.0.2.10",
  country: "BR",
  region: "São Paulo",
  city: "Campinas",
  asn: 64500,
  userAgent: "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/140.0 Mobile Safari/537.36",
  knownDevice: true,
  count: 1,
  ...over,
});

describe("the access log's helpers", () => {
  it("has a label for every kind", () => {
    for (const kind of AUTH_EVENT_KINDS) expect(KIND_LABEL[kind]).toMatch(/^web\.activity\.kind\./);
  });

  it("reads the known reasons in order and drops unknown or empty parts", () => {
    expect(reasonLabels("")).toEqual([]);
    expect(reasonLabels("totp,new_device")).toEqual(["web.accessLog.reason.totp", "web.accessLog.reason.new_device"]);
    expect(reasonLabels(" missing ,credentials,,x")).toEqual(["web.accessLog.reason.missing"]);
    expect(reasonLabels("__proto__,constructor")).toEqual([]);
    expect(reasonLabels("code,daily_cap")).toEqual(["web.accessLog.reason.daily_cap"]);
    expect(reasonLabels("link_sent")).toEqual(["web.accessLog.reason.link_sent"]);
  });

  it("groups and flags kinds the way the badges show them", () => {
    expect(groupOf("login_success")).toBe("success");
    expect(groupOf("mfa_failure")).toBe("failure");
    expect(groupOf("login_attack")).toBe("blocked");
    expect(groupOf("login_turnstile")).toBe("robot");
    expect(groupOf("logout")).toBe("account");
    expect(isWarning("login_turnstile")).toBe(true);
    expect(isWarning("credentials_reset")).toBe(true);
    expect(isWarning("logout")).toBe(false);
  });

  it("names the country in the owner's language, with its code and whether it is outside Brazil (E12a)", () => {
    const t = (key: string) => `<${key}>`;
    expect(placeParts(event(), "pt-BR", t)).toEqual({ city: "Campinas, São Paulo", country: "Brasil", code: "BR", abroad: false });
    expect(placeParts(event(), "en", t)).toEqual({ city: "Campinas, São Paulo", country: "Brazil", code: "BR", abroad: false });
    expect(placeParts(event({ city: "", region: "", country: "PT" }), "pt-BR", t)).toEqual({ city: "", country: "Portugal", code: "PT", abroad: true });
    // The edge's two codes that name no country: still not known to be home.
    expect(placeParts(event({ country: "XX" }), "pt-BR", t)).toMatchObject({ country: "<web.activity.countryUnknown>", code: "XX", abroad: true });
    expect(placeParts(event({ country: "T1" }), "pt-BR", t)).toMatchObject({ country: "<web.activity.tor>", code: "T1", abroad: true });
    // No country (a local run) or something that isn't a code: nothing to name, nothing to flag.
    expect(placeParts(event({ city: "", region: "", country: "" }), "pt-BR", t)).toEqual({ city: "", country: "", code: "", abroad: false });
    // Not a code the edge sends: an unknown country, never its text, and outside Brazil as the server's filter counts it.
    expect(placeParts(event({ country: "<b>" }), "pt-BR", t)).toEqual({ city: "Campinas, São Paulo", country: "<web.activity.countryUnknown>", code: "", abroad: true });
    expect(placeParts(event({ country: "br" }), "pt-BR", t)).toMatchObject({ code: "", abroad: true });
  });

  it("describes the browser, or only the half it knows, or nothing", () => {
    const format = (browser: string, system: string) => `${browser} no ${system}`;
    expect(deviceText(event(), format)).toBe("Chrome no Android");
    expect(deviceText(event({ userAgent: "" }), format)).toBe("");
    expect(deviceText(event({ userAgent: "curl/8.0" }), format)).toBe("");
  });
});

describe("the access log's days (E12a)", () => {
  it("takes the day in the owner's zone, not the device's or UTC", () => {
    // 02:30 UTC on the 16th is still the 15th in São Paulo, and already the 16th in Tokyo.
    expect(dayKey("2026-11-16T02:30:00.000Z", "America/Sao_Paulo")).toBe("2026-11-15");
    expect(dayKey("2026-11-16T02:30:00.000Z", "Asia/Tokyo")).toBe("2026-11-16");
    expect(dayKey("2026-11-16T03:00:00.000Z", "America/Sao_Paulo")).toBe("2026-11-16");
  });

  it("finds yesterday by the calendar, across a month, a year and the 23- and 25-hour days", () => {
    expect(dayBefore("2026-11-16")).toBe("2026-11-15");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2026-01-01")).toBe("2025-12-31");
    // New York's 23-hour day (08/03/2026) and 25-hour day (01/11/2026): the day after each still says the day before.
    expect(dayBefore(dayKey("2026-03-09T12:00:00.000Z", "America/New_York"))).toBe("2026-03-08");
    expect(dayBefore(dayKey("2026-11-02T12:00:00.000Z", "America/New_York"))).toBe("2026-11-01");
    // 23:30 and 00:30 of the 23-hour day, an hour of the clock apart from UTC's: one block.
    expect(byDay([{ at: "2026-03-09T03:30:00.000Z" }, { at: "2026-03-08T05:30:00.000Z" }], "America/New_York").map((d) => d.day)).toEqual(["2026-03-08"]);
  });

  it("puts the rows in blocks of a day, in the order they came, and a second page goes on in the same block", () => {
    const page1 = [{ at: "2026-11-16T11:00:00.000Z" }, { at: "2026-11-16T03:10:00.000Z" }, { at: "2026-11-16T02:50:00.000Z" }];
    const page2 = [{ at: "2026-11-16T02:40:00.000Z" }, { at: "2026-11-14T20:00:00.000Z" }];
    const one = byDay(page1, "America/Sao_Paulo");
    expect(one.map((d) => [d.day, d.events.length])).toEqual([
      ["2026-11-16", 2],
      ["2026-11-15", 1],
    ]);
    const both = byDay([...page1, ...page2], "America/Sao_Paulo");
    expect(both.map((d) => [d.day, d.events.length])).toEqual([
      ["2026-11-16", 2],
      ["2026-11-15", 2],
      ["2026-11-14", 1],
    ]);
    expect(byDay([], "America/Sao_Paulo")).toEqual([]);
  });
});
