import { describe, expect, it } from "vitest";
import {
  DEFAULT_SETTINGS,
  DEFAULT_TIME_ZONE,
  isTimeZone,
  normalizeOwnerName,
  OWNER_NAME_MAX,
  settingsSchema,
  settingsUpdateSchema,
} from "../src/index.ts";

describe("default settings", () => {
  it("start in pt-BR, in the São Paulo time zone, with sign-out after 30 min idle, 5 min without a tab or 6 h, memory conflict review on, the AI limits of the specification, the priority that learns on, and no owner name yet", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      language: "pt-BR",
      timeZone: "America/Sao_Paulo",
      sessionIdleMinutes: 30,
      sessionPresenceMinutes: 5,
      sessionMaxHours: 6,
      memoryConflictReview: true,
      aiModel: "@cf/zai-org/glm-4.7-flash",
      aiFallbackModel: "@cf/qwen/qwen3-30b-a3b-fp8",
      aiRequestsPerDay: 200,
      aiNeuronsPerDay: 9_000,
      aiMaxOutputTokens: 1_024,
      aiMaxToolCalls: 6,
      aiMaxIterations: 4,
      aiMaxContextTokens: 6_000,
      aiScheduledRunsPerDay: 6,
      // Step 21: the paid models' US$ ceiling is off (0) until the owner picks a value.
      aiUsdCentsPerDay: 0,
      ownerName: "",
      digestEnabled: true,
      digestTime: "07:30",
      watchersEnabled: true,
      alertRoutes: {
        reminders: ["push", "telegram"],
        digests: ["push", "telegram"],
        routines: ["push", "telegram"],
        tasks: ["push", "telegram"],
        system: ["push", "telegram"],
        security: ["push", "telegram", "email"],
        events: ["push", "telegram"],
      },
      alertPerHour: 6,
      alertPerDay: 30,
      alertLearning: true,
      alertFullText: [],
      agenda: { from: 8, to: 18, view: "week", weekStart: 1, workDays: [1, 2, 3, 4, 5], daysOff: true, allDay: true, outside: true },
      sounds: { notice: true, pick: "sino", recording: true },
    });
    expect(DEFAULT_TIME_ZONE).toBe("America/Sao_Paulo");
    expect(settingsSchema.parse(DEFAULT_SETTINGS)).toEqual(DEFAULT_SETTINGS);
  });

  it("take a fallback model from the free list, or none; never a model off the list", () => {
    expect(settingsUpdateSchema.safeParse({ aiFallbackModel: "none" }).success).toBe(true);
    expect(settingsUpdateSchema.safeParse({ aiFallbackModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast" }).success).toBe(true);
    for (const bad of ["", "None", "@cf/openai/gpt-4o", null, 1]) expect(settingsUpdateSchema.safeParse({ aiFallbackModel: bad }).success).toBe(false);
    // The default pair is always two different models.
    expect(DEFAULT_SETTINGS.aiFallbackModel).not.toBe(DEFAULT_SETTINGS.aiModel);
  });

  it("take only a boolean for memory conflict review", () => {
    expect(settingsUpdateSchema.safeParse({ memoryConflictReview: false }).success).toBe(true);
    for (const value of ["false", 0, null, "yes"]) expect(settingsUpdateSchema.safeParse({ memoryConflictReview: value }).success).toBe(false);
  });

  it("take alert routes per known category, dropping a repeated channel", () => {
    expect(settingsUpdateSchema.parse({ alertRoutes: { security: ["email", "email", "push"] } })).toEqual({ alertRoutes: { security: ["email", "push"] } });
    for (const alertRoutes of [{ security: ["sms"] }, { other: ["push"] }, { tasks: ["push", "push", "push", "push"] }, { tasks: "push" }]) {
      expect(settingsUpdateSchema.safeParse({ alertRoutes }).success, JSON.stringify(alertRoutes)).toBe(false);
    }
  });

  it("take the sounds whole: one of the three notice sounds, two switches, nothing extra (CA2)", () => {
    const sounds = DEFAULT_SETTINGS.sounds;
    const ok = (patch: object) => settingsUpdateSchema.safeParse({ sounds: { ...sounds, ...patch } });
    for (const pick of ["sino", "gota", "marimba"]) expect(ok({ pick }).success, pick).toBe(true);
    expect(ok({ notice: false, recording: false }).data?.sounds).toEqual({ notice: false, pick: "sino", recording: false });
    for (const bad of [{ pick: "buzina" }, { pick: "" }, { pick: "Sino" }, { pick: 1 }, { pick: null }, { notice: "true" }, { notice: 1 }, { recording: null }, { volume: 11 }, { pick: "https://exemplo.com.br/som.mp3" }]) {
      expect(ok(bad).success, JSON.stringify(bad)).toBe(false);
    }
    // A piece alone is refused, like the Agenda's: a half never lands.
    for (const half of [{ pick: "gota" }, { notice: false }, {}, null, "sino", []]) expect(settingsUpdateSchema.safeParse({ sounds: half }).success, JSON.stringify(half)).toBe(false);
  });

  it("take the Agenda's preferences whole: hours in order, a known view, week days tidied, nothing extra", () => {
    const agenda = DEFAULT_SETTINGS.agenda;
    const ok = (patch: object) => settingsUpdateSchema.safeParse({ agenda: { ...agenda, ...patch } });
    // The limits: midnight to 01:00, 23:00 to midnight, the whole day.
    for (const hours of [{ from: 0, to: 1 }, { from: 23, to: 24 }, { from: 0, to: 24 }]) expect(ok(hours).success, JSON.stringify(hours)).toBe(true);
    for (const hours of [{ from: 8, to: 8 }, { from: 18, to: 8 }, { from: -1, to: 8 }, { from: 24, to: 24 }, { from: 0, to: 25 }, { from: 0, to: 0 }, { from: 8.5, to: 18 }, { from: "8", to: 18 }]) {
      expect(ok(hours).success, JSON.stringify(hours)).toBe(false);
    }
    expect(ok({ workDays: [5, 1, 1, 0] }).data?.agenda?.workDays).toEqual([0, 1, 5]);
    for (const bad of [{ workDays: [] }, { workDays: [7] }, { workDays: [-1] }, { workDays: [1, 2, 3, 4, 5, 6, 0, 1] }, { workDays: "1" }, { view: "year" }, { weekStart: 2 }, { weekStart: "1" }, { daysOff: 1 }, { allDay: null }, { outside: "no" }, { extra: true }]) {
      expect(ok(bad).success, JSON.stringify(bad)).toBe(false);
    }
    // A piece alone is refused: the screen saves the whole card, so a half never lands.
    expect(settingsUpdateSchema.safeParse({ agenda: { from: 9 } }).success).toBe(false);
  });

  it("cannot be changed in place", () => {
    expect(Object.isFrozen(DEFAULT_SETTINGS)).toBe(true);
  });
});

describe("isTimeZone", () => {
  it.each(["America/Sao_Paulo", "America/Noronha", "Europe/Lisbon", "UTC", "Etc/GMT+3", "America/Argentina/Buenos_Aires"])(
    "accepts %s",
    (zone) => expect(isTimeZone(zone)).toBe(true),
  );

  it.each([
    "",
    "Mars/Olympus_Mons",
    "America/Sao Paulo",
    "../etc/passwd",
    "America/Sao_Paulo\n",
    "<script>",
    `America/${"A".repeat(60)}`,
    "-03:00",
  ])("refuses %j", (zone) => expect(isTimeZone(zone)).toBe(false));
});

describe("session timeouts", () => {
  it.each([
    ["sessionIdleMinutes", 5, 60],
    ["sessionPresenceMinutes", 3, 15],
    ["sessionMaxHours", 1, 24],
  ] as const)("%s accepts %i to %i and nothing outside", (field, min, max) => {
    for (const ok of [min, min + 1, max - 1, max]) expect(settingsUpdateSchema.safeParse({ [field]: ok }).success, `${ok}`).toBe(true);
    for (const bad of [min - 1, max + 1, min + 0.5, "10", null]) {
      expect(settingsUpdateSchema.safeParse({ [field]: bad }).success, `${bad}`).toBe(false);
    }
  });
});

describe("settingsUpdateSchema", () => {
  it("accepts a change of one field", () => {
    expect(settingsUpdateSchema.parse({ language: "en" })).toEqual({ language: "en" });
    expect(settingsUpdateSchema.parse({ timeZone: "Europe/Lisbon" })).toEqual({ timeZone: "Europe/Lisbon" });
  });

  it.each([
    {},
    { language: "fr" },
    { language: "PT-BR" },
    { language: null },
    { timeZone: "Nowhere/City" },
    { timeZone: 3 },
    { theme: "dark" },
    { language: "en", __proto__: { admin: true }, extra: 1 },
  ])("refuses %j", (patch) => expect(settingsUpdateSchema.safeParse(patch).success).toBe(false));
});

describe("owner name", () => {
  const parse = (ownerName: unknown) => settingsUpdateSchema.safeParse({ ownerName });

  it("keeps up to 40 characters after tidying the spaces, and an empty name means none", () => {
    expect(OWNER_NAME_MAX).toBe(40);
    expect(parse("").data).toEqual({ ownerName: "" });
    expect(parse("Pablo").data).toEqual({ ownerName: "Pablo" });
    expect(parse("   Ana \t  Clara\n ").data).toEqual({ ownerName: "Ana Clara" });
    expect(parse("   ").data).toEqual({ ownerName: "" });
    expect(parse("a".repeat(39)).success).toBe(true);
    expect(parse("a".repeat(40)).success).toBe(true);
    expect(parse("a".repeat(41)).success).toBe(false);
    // Spaces around don't count toward the limit; letters outside the BMP count once each.
    expect(parse(`  ${"a".repeat(40)}  `).success).toBe(true);
    expect(parse("𝒜".repeat(40)).success).toBe(true);
    expect(parse("𝒜".repeat(41)).success).toBe(false);
  });

  it("stores accents in one form, so the same name typed twice is the same", () => {
    expect(normalizeOwnerName("Jose\u0301")).toBe("José");
    expect(parse("Jose\u0301").data).toEqual({ ownerName: "José" });
  });

  it.each([
    "<b>Pablo</b>",
    "Pablo>",
    "Pa\u0000blo",
    "Pa\u0007blo",
    "Pa\u200Bblo",
    "Pablo\u202E",
    "a".repeat(1_000),
    // Blank look-alikes: the greeting would read "Bom dia, !".
    "\u3164",
    "\u2800\u2800",
    "\u115F\u1160",
    "\u0336\u0301",
    "...",
    // Private use, unassigned, a lone surrogate.
    "Pablo\uE000",
    "Pablo\u0378",
    "Pablo\uD800",
    // Brackets a model may read as a tag, the ones <data> uses included.
    "‹/data›",
    "＜b＞",
    "﹤x﹥",
    "〈x〉",
    // Zalgo: more than three marks left on one letter after NFC.
    "Za\u0301\u0302\u0303\u0304\u0305",
  ])("refuses %j", (name) => expect(parse(name).success).toBe(false));

  it.each([3, null, ["Pablo"], { name: "Pablo" }, true])("refuses the non-text %j", (name) => expect(parse(name).success).toBe(false));

  it("accepts names from any language, with apostrophes and hyphens", () => {
    for (const name of ["Maria-José", "D'Ávila", "Zoë", "李小龙", "Ольга", "José da Silva Júnior", "Nguyễn", "R2", "Ana 😊", "Ana (Nina)", "Dra. Ana"]) expect(parse(name).success, name).toBe(true);
  });
});
