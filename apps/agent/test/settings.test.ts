import { AGENT_INSTANCE_NAME, DEFAULT_SETTINGS } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { Database } from "../src/db/database.ts";
import { migrate } from "../src/db/migrations.ts";
import { SettingsRepository } from "../src/db/settings.ts";
import { AppError } from "../src/http/errors.ts";
import { CSRF, ORIGIN, call, errorBody, testEnv } from "./helpers.ts";

const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent, db: Database) => T | Promise<T>) =>
  runInDurableObject(owner(), (agent: ZuriAgent, state) => fn(agent, new Database(state.storage)));

function withRepository<T>(
  name: string,
  fn: (settings: SettingsRepository, db: Database) => T,
  installDefaults?: { timeZone?: string },
): Promise<T> {
  const stub = testEnv.AGENT.get(testEnv.AGENT.idFromName(`settings-test-${name}`));
  return runInDurableObject(stub, (_agent: ZuriAgent, state) => {
    const db = new Database(state.storage);
    migrate(db);
    return fn(new SettingsRepository(db, installDefaults), db);
  });
}

describe("SettingsRepository", () => {
  it("returns the defaults on a new database", async () => {
    await withRepository("defaults", (settings) => {
      expect(settings.get()).toEqual({ ...DEFAULT_SETTINGS, language: "pt-BR", timeZone: "America/Sao_Paulo" });
      expect(settings.locale()).toBe("pt-BR");
    });
  });

  it("starts from the deploy's DEFAULT_TIMEZONE when it is valid, and ignores it when not", async () => {
    await withRepository("install-zone", (settings) => expect(settings.get().timeZone).toBe("America/Manaus"), {
      timeZone: "America/Manaus",
    });
    for (const timeZone of ["", "  ", "Nowhere/City", "America/Sao Paulo"]) {
      await withRepository(`install-bad-${timeZone.length}`, (settings) => expect(settings.get().timeZone).toBe("America/Sao_Paulo"), {
        timeZone,
      });
    }
  });

  it("uses the deploy's time zone in the owner's instance", async () => {
    expect(testEnv.DEFAULT_TIMEZONE).toBe("America/Sao_Paulo");
    expect(await inOwner((agent) => agent.store.settings.get().timeZone)).toBe("America/Sao_Paulo");
  });

  it("saves a change and keeps the other fields at their defaults", async () => {
    await withRepository("update", (settings, db) => {
      expect(settings.update({ language: "en" })).toEqual({ ...DEFAULT_SETTINGS, language: "en", timeZone: "America/Sao_Paulo" });
      expect(settings.get().language).toBe("en");
      expect(db.all(`SELECT key, value FROM zur_settings`)).toEqual([{ key: "language", value: '"en"' }]);

      settings.update({ timeZone: "Europe/Lisbon" });
      expect(settings.get()).toEqual({ ...DEFAULT_SETTINGS, language: "en", timeZone: "Europe/Lisbon" });
    });
  });

  it("logs which fields changed, never their values, and nothing for a no-op", async () => {
    await withRepository("activity", (settings, db) => {
      settings.update({ language: "en", timeZone: "UTC" });
      settings.update({ language: "en" });
      const rows = db.all<{ kind: string; detail: string }>(`SELECT kind, detail FROM zur_activity`);
      expect(rows).toEqual([{ kind: "settings.updated", detail: JSON.stringify({ fields: ["language", "timeZone"] }) }]);
      expect(rows[0]?.detail).not.toContain("UTC");
    });
  });

  it("refuses an invalid change with VALIDATION_FAILED, the field names only, and writes nothing", async () => {
    await withRepository("invalid", (settings, db) => {
      for (const patch of [{}, { language: "fr" }, { timeZone: "Nowhere/<script>" }, { theme: "dark" }, { language: "en", extra: 1 }]) {
        let error: unknown;
        try {
          settings.update(patch as never);
        } catch (e) {
          error = e;
        }
        expect(error, JSON.stringify(patch)).toBeInstanceOf(AppError);
        expect((error as AppError).code).toBe("VALIDATION_FAILED");
        expect(JSON.stringify((error as AppError).details)).not.toMatch(/fr|script|dark/);
      }
      expect(db.all(`SELECT * FROM zur_settings`)).toEqual([]);
      expect(db.all(`SELECT * FROM zur_activity`)).toEqual([]);
    });
  });

  it("saves the notice settings (step 11) and refuses times, limits and routes out of range", async () => {
    await withRepository("notices", (settings) => {
      const saved = settings.update({
        digestEnabled: false,
        digestTime: "06:45",
        watchersEnabled: false,
        alertPerHour: 60,
        alertPerDay: 1,
        alertLearning: false,
        alertRoutes: { security: ["push", "email"], digests: [] },
      });
      expect(saved).toMatchObject({ digestEnabled: false, digestTime: "06:45", watchersEnabled: false, alertPerHour: 60, alertPerDay: 1, alertLearning: false });
      expect(settings.get().alertLearning).toBe(false);
      expect(settings.get().alertRoutes).toEqual({ security: ["push", "email"], digests: [] });
      // Saving the same routes again is a no-op, not a change.
      expect(() => settings.update({ alertRoutes: { security: ["push", "email"], digests: [] } })).not.toThrow();
      for (const patch of [
        { digestTime: "24:00" },
        { digestTime: "7:30" },
        { alertPerHour: 0 },
        { alertPerHour: 61 },
        { alertPerDay: 501 },
        { alertRoutes: { security: ["sms"] } },
        { alertRoutes: { nope: ["push"] } },
        { alertLearning: "yes" },
      ]) {
        expect(() => settings.update(patch as never), JSON.stringify(patch)).toThrow(AppError);
      }
    });
  });

  it("saves the Agenda's preferences whole in one row, and reads a stored one that no longer fits as the default", async () => {
    await withRepository("agenda", (settings, db) => {
      const agenda = { from: 7, to: 20, view: "day" as const, weekStart: 0 as const, workDays: [6, 1, 1], daysOff: false, outside: false, lunch: { from: 720, to: 780 }, closed: [] };
      expect(settings.update({ agenda }).agenda).toEqual({ ...agenda, workDays: [1, 6] });
      expect(db.all(`SELECT key FROM zur_settings`)).toEqual([{ key: "agenda" }]);
      // The same card saved again writes nothing.
      const before = db.all(`SELECT * FROM zur_activity`).length;
      settings.update({ agenda: { ...agenda, workDays: [1, 6] } });
      expect(db.all(`SELECT * FROM zur_activity`)).toHaveLength(before);
      for (const patch of [{ ...agenda, from: 20, to: 20 }, { ...agenda, to: 25 }, { ...agenda, workDays: [] }, { from: 9 }, { ...agenda, more: 1 }]) {
        expect(() => settings.update({ agenda: patch } as never), JSON.stringify(patch)).toThrow(AppError);
      }
      // Hours a hand-edited row left upside down never reach the screen.
      db.run(`UPDATE zur_settings SET value = ? WHERE key = 'agenda'`, JSON.stringify({ ...agenda, from: 22, to: 3 }));
      expect(settings.get().agenda).toEqual(DEFAULT_SETTINGS.agenda);
    });
  });

  it("reads a record saved before 13/11/2026 (with the all-day choice, without lunch, holidays or days off) and drops what is gone", async () => {
    await withRepository("agenda-old", (settings, db) => {
      const old = { from: 7, to: 20, view: "week", weekStart: 1, workDays: [1, 2, 3, 4, 5], daysOff: true, allDay: false, outside: true };
      db.run(`INSERT INTO zur_settings (key, value, updated_at) VALUES ('agenda', ?, 'x')`, JSON.stringify(old));
      const { allDay: _gone, ...rest } = old;
      expect(settings.get().agenda).toEqual({ ...rest, lunch: null, closed: [] });
    });
  });

  it("keeps the lunch break inside the hours and the periods off in order, none over another", async () => {
    await withRepository("agenda-rules", (settings) => {
      const agenda = { ...DEFAULT_SETTINGS.agenda, from: 8, to: 18 };
      // Periods off come back in order; a record of the old shape (one day, opened holidays) still saves.
      const saved = settings.update({
        agenda: { ...agenda, openHolidays: ["2026-12-25"], closed: [{ from: "2027-01-18", to: "2027-01-29", reason: "Férias" }, { date: "2026-12-24", reason: " " }] } as never,
      }).agenda;
      expect(saved).not.toHaveProperty("openHolidays");
      expect(saved.closed).toEqual([
        { from: "2026-12-24", to: "2026-12-24", reason: "" },
        { from: "2027-01-18", to: "2027-01-29", reason: "Férias" },
      ]);
      expect(settings.update({ agenda: { ...agenda, lunch: null } }).agenda.lunch).toBeNull();
      for (const patch of [
        // Lunch on the quarter hour, longer than 3 h, touching the start or the end, or upside down.
        { ...agenda, lunch: { from: 735, to: 780 } },
        { ...agenda, lunch: { from: 600, to: 810 } },
        { ...agenda, lunch: { from: 480, to: 540 } },
        { ...agenda, lunch: { from: 1020, to: 1080 } },
        { ...agenda, lunch: { from: 780, to: 720 } },
        // An impossible date, a repeated day off, two periods one over the other, an end before the start, 91 days, a long reason, too many periods.
        { ...agenda, closed: [{ from: "2026-02-30", to: "2026-03-01", reason: "" }] },
        { ...agenda, closed: [{ date: "2026-12-24", reason: "" }, { date: "2026-12-24", reason: "Natal" }] },
        { ...agenda, closed: [{ from: "2027-01-01", to: "2027-01-10", reason: "" }, { from: "2027-01-10", to: "2027-01-11", reason: "" }] },
        { ...agenda, closed: [{ from: "2027-01-10", to: "2027-01-09", reason: "" }] },
        { ...agenda, closed: [{ from: "2027-01-01", to: "2027-04-01", reason: "" }] },
        { ...agenda, closed: [{ from: "2026-12-24", to: "2026-12-24", reason: "x".repeat(41) }] },
        { ...agenda, closed: Array.from({ length: 101 }, (_, index) => { const day = new Date(Date.UTC(2027, 0, 1 + index * 2)).toISOString().slice(0, 10); return { from: day, to: day, reason: "" }; }) },
      ]) {
        expect(() => settings.update({ agenda: patch } as never), JSON.stringify(patch).slice(0, 120)).toThrow(AppError);
      }
    });
  });

  it("saves the sounds whole in one row without a migration, and reads a stored one that no longer fits as the default (CA2)", async () => {
    await withRepository("sounds", (settings, db) => {
      expect(settings.get().sounds).toEqual({ notice: true, pick: "sino", recording: true });
      expect(settings.field("sounds")).toEqual(DEFAULT_SETTINGS.sounds);
      const sounds = { notice: false, pick: "marimba" as const, recording: false };
      expect(settings.update({ sounds }).sounds).toEqual(sounds);
      expect(db.all(`SELECT key, value FROM zur_settings`)).toEqual([{ key: "sounds", value: JSON.stringify(sounds) }]);
      // The same choice saved again writes nothing.
      const before = db.all(`SELECT * FROM zur_activity`).length;
      settings.update({ sounds });
      expect(db.all(`SELECT * FROM zur_activity`)).toHaveLength(before);
      for (const patch of [{ ...sounds, pick: "buzina" }, { pick: "gota" }, { ...sounds, notice: 1 }, { ...sounds, file: "som.mp3" }]) {
        expect(() => settings.update({ sounds: patch } as never), JSON.stringify(patch)).toThrow(AppError);
      }
      expect(settings.get().sounds).toEqual(sounds);
      // A sound a hand-edited row names, or an older version allowed, never reaches the screen.
      db.run(`UPDATE zur_settings SET value = ? WHERE key = 'sounds'`, JSON.stringify({ ...sounds, pick: "sirene" }));
      expect(settings.get().sounds).toEqual(DEFAULT_SETTINGS.sounds);
    });
  });

  it("reads a corrupt or no longer valid stored value as the default", async () => {
    await withRepository("corrupt", (settings, db) => {
      db.run(`INSERT INTO zur_settings (key, value, updated_at) VALUES ('language', '"fr"', 'x'), ('time_zone', '{not json', 'x')`);
      expect(settings.get()).toEqual(DEFAULT_SETTINGS);
      db.run(`UPDATE zur_settings SET value = '"Mars/Base"' WHERE key = 'time_zone'`);
      expect(settings.get().timeZone).toBe("America/Sao_Paulo");
    });
  });
});

describe("API errors in the owner's language", () => {
  it("answer in pt-BR by default and in English after the owner switches", async () => {
    const before = await errorBody(await call(`${ORIGIN}/api/tasks`, { headers: CSRF }));
    expect(before).toEqual({ code: "UNAUTHORIZED", message: "Entre para continuar." });

    await inOwner((agent) => agent.store.settings.update({ language: "en" }));
    const unauthorized = await errorBody(await call(`${ORIGIN}/api/tasks`, { headers: CSRF }));
    expect(unauthorized).toEqual({ code: "UNAUTHORIZED", message: "Sign in to continue." });

    await inOwner((agent) => agent.store.settings.update({ language: "pt-BR" }));
    expect((await errorBody(await call(`${ORIGIN}/api/tasks`, { headers: CSRF }))).message).toBe("Entre para continuar.");
  });

  it("keep the stable code whatever the language", async () => {
    await inOwner((agent) => agent.store.settings.update({ language: "en" }));
    const res = await call(`${ORIGIN}/api/nada`, { method: "POST", headers: CSRF });
    expect(res.status).toBe(401);
    expect(await errorBody(res)).toEqual({ code: "UNAUTHORIZED", message: "Sign in to continue." });
  });

  it("stay in the default language for the Worker's gates, which answer before the object is woken", async () => {
    await inOwner((agent) => agent.store.settings.update({ language: "en" }));
    const res = await call("https://outro.exemplo.com.br/api/tasks", { headers: CSRF });
    expect(await errorBody(res)).toEqual({ code: "HOST_NOT_ALLOWED", message: "Este endereço não atende a Zuri." });
  });

  it("fall back to pt-BR if the database cannot be read, and log only the error's name", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const locale = await inOwner((agent, db) => {
      agent.store.settings.update({ language: "en" });
      // Simulates a broken database: the settings table disappears under the agent.
      db.run(`ALTER TABLE zur_settings RENAME TO zur_settings_gone`);
      return agent.locale();
    });
    expect(locale).toBe("pt-BR");
    const res = await call(`${ORIGIN}/api/tasks`, { headers: CSRF });
    expect(res.status).toBe(401);
    expect((await errorBody(res)).message).toBe("Entre para continuar.");
    // Put the table back so a test added after this one finds a whole database.
    await inOwner((_agent, db) => db.run(`ALTER TABLE zur_settings_gone RENAME TO zur_settings`));
    expect(log).toHaveBeenCalledWith(JSON.stringify({ level: "error", event: "settings_unreadable", error: "Error" }));
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/zur_settings|SELECT/);
    log.mockRestore();
  });
});
