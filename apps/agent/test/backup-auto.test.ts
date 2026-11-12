import { AGENT_INSTANCE_NAME, BACKUP_COPIES_KEPT, type BackupAutoStatus, type BackupKeyFile, createBackupKey, openBackup } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inWake, WakeBudget } from "../src/agent/wake-budget.ts";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { AutomaticBackup, type AutomaticBackupDeps, BACKUP_R2_CALLS_PER_RUN } from "../src/backup/automatic.ts";
import { MemoryBucket } from "../src/backup/dev-bucket.ts";
import { exportBackup } from "../src/backup/export.ts";
import { InternalState } from "../src/db/internal-state.ts";
import type { TelegramClient } from "../src/telegram/client.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv, signedCookies } from "./helpers.ts";

// Step 23b: the automatic backup. A sealed copy a day in the bucket, the newest 7
// kept, nothing deleted when an upload fails; the month's copy to Telegram, the
// 30-day warning, and the screen's routes.

const IP = "192.0.2.232";
const ZONE = "America/Sao_Paulo";
let cookie = "";
const owner = () => testEnv.AGENT.get(testEnv.AGENT.idFromName(AGENT_INSTANCE_NAME));
const inOwner = <T>(fn: (agent: ZuriAgent) => T | Promise<T>) => runInDurableObject(owner(), (agent: ZuriAgent) => fn(agent));

const session = (method: string, path: string, body?: unknown) =>
  call(`${ORIGIN}/api${path}`, {
    method,
    headers: { ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP, cookie },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

async function signIn(): Promise<void> {
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: { ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP },
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  cookie = signedCookies(res);
}

const fresh = () => inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now()));

interface Sent {
  method: "sendDocument" | "sendMessage";
  chat: number;
  text: string;
  size?: number;
  filename?: string;
}

/** A clock the test moves, a bucket in memory and a bot that only writes down what it was asked to send. */
function harness(agent: ZuriAgent, overrides: Partial<AutomaticBackupDeps> = {}) {
  let now = new Date("2026-11-10T05:59:00Z"); // 02:59 in São Paulo
  const bucket = new MemoryBucket(() => now, 1024);
  const sent: Sent[] = [];
  // No bot unless a test links one: most tests are about the bucket alone.
  let chat: number | null = null;
  let lockdown = false;
  let telegramDown = false;
  const client = {
    sendMessage: async (id: number, text: string) => {
      if (telegramDown) throw new Error("Telegram is down");
      sent.push({ method: "sendMessage", chat: id, text });
      return { message_id: 1 };
    },
    sendDocument: async (id: number, file: Blob, filename: string, caption: string) => {
      if (telegramDown) throw new Error("Telegram is down");
      sent.push({ method: "sendDocument", chat: id, text: caption, size: file.size, filename });
      return { message_id: 2 };
    },
  } as unknown as TelegramClient;
  const state = new InternalState(agent.store.db);
  const backup = new AutomaticBackup({
    state,
    bucket: () => bucket,
    source: () => exportBackup({ db: agent.store.db, settings: () => agent.store.settings.get() }),
    timeZone: () => ZONE,
    locale: () => "pt-BR",
    origin: () => "https://zuri.exemplo.com.br",
    lockdown: () => lockdown,
    firstSignIn: () => Date.parse("2026-11-01T12:00:00Z"),
    telegram: { chat: () => chat, client: () => client },
    now: () => now,
    partBytes: 1024,
    ...overrides,
  });
  return {
    backup,
    bucket,
    sent,
    state,
    at: (iso: string) => {
      now = new Date(iso);
    },
    withChat: () => {
      chat = 4242;
    },
    noChat: () => {
      chat = null;
    },
    telegramDown: (down: boolean) => {
      telegramDown = down;
    },
    lock: (on: boolean) => {
      lockdown = on;
    },
  };
}

async function withKey(backup: AutomaticBackup): Promise<BackupKeyFile> {
  const { publicKey, file } = await createBackupKey();
  await backup.setKey({ key: file.key, publicKey });
  return file;
}

async function opened(bytes: Uint8Array, key: BackupKeyFile): Promise<string> {
  const gzip = await openBackup(bytes, key);
  return new Response(new Response(gzip).body?.pipeThrough(new DecompressionStream("gzip"))).text();
}

beforeAll(signIn);
beforeEach(fresh);
afterEach(() =>
  inOwner(async (agent) => {
    await agent.store.alerts.settled();
    const { db } = agent.store;
    db.run(`DELETE FROM zur_auth_events`);
    db.run(`DELETE FROM zur_notices`);
    db.run(`DELETE FROM zur_alert_keys`);
    db.run(`DELETE FROM zur_notes`);
    new InternalState(db).delete("backup");
  }),
);

describe("the day's copy", () => {
  it("does nothing without the bucket or the key, and waits for 3 a.m. in the owner's zone", () =>
    inOwner(async (agent) => {
      const none = harness(agent, { bucket: () => null });
      await withKey(none.backup);
      // Without the bucket or the bot nothing has a time: the alarm isn't woken for a warning no one gets.
      expect(none.backup.nextDue()).toBeNull();
      none.withChat();
      // With the bot, the warning's: more than 30 days after the first sign-in.
      expect(none.backup.nextDue()).toBe("2026-12-02T12:00:00.000Z");
      none.lock(true);
      expect(none.backup.nextDue()).toBeNull();
      expect(await none.backup.tick()).toBe(false);
      expect((await none.backup.status()).available).toBe(false);
      none.state.delete("backup");

      const h = harness(agent);
      expect((await h.backup.status()).nextAt).toBeNull();
      expect(await h.backup.tick()).toBe(false);
      expect(h.bucket.objects.size).toBe(0);
      await withKey(h.backup);
      expect(h.backup.nextDue()).toBe("2026-11-10T06:00:00.000Z");
      expect(await h.backup.tick()).toBe(false);
      // Only the status above read the bucket: the tick before 3 a.m. made no call.
      expect(h.bucket.calls).toEqual({ ListObjects: 1 });
    }));

  it("uploads one sealed copy that opens with the key into the manual backup's JSON, with a name that says nothing about the owner", () =>
    inOwner(async (agent) => {
      agent.store.productivity.notes.create({ title: "Receita da vó", content: "farinha, ovos" });
      const h = harness(agent);
      const key = await withKey(h.backup);
      h.at("2026-11-10T06:00:00Z");
      expect(await h.backup.tick()).toBe(true);
      expect(h.bucket.objects.size).toBe(1);
      const [name, stored] = [...h.bucket.objects.entries()][0] ?? ["", { bytes: new Uint8Array() }];
      expect(name).toMatch(/^zuri\/2026-11-10-[0-9a-f]{8}\.zuri$/);
      expect(name).not.toContain("dono");
      const text = await opened(stored.bytes, key);
      const parsed = JSON.parse(text) as { format: string; data: { notes: { title: string }[] } };
      expect(parsed.format).toBe("zuri-backup");
      expect(parsed.data.notes.map((note) => note.title)).toEqual(["Receita da vó"]);
      // Nothing of the note shows through the seal.
      expect(new TextDecoder().decode(stored.bytes)).not.toContain("Receita");
      // The file is small: one put, one list for the prune, no delete.
      expect(h.bucket.calls).toEqual({ PutObject: 1, ListObjects: 1 });
      const status = await h.backup.status();
      expect(status.copies).toHaveLength(1);
      expect(status.last?.size).toBe(stored.bytes.length);
      expect(status.failure).toBeNull();
      // The next one is the next day's 3 a.m.
      expect(status.nextAt).toBe("2026-11-11T06:00:00.000Z");
      expect(await h.backup.tick()).toBe(false);
    }));

  it("uploads a big copy in parts of one size and the last smaller", () =>
    inOwner(async (agent) => {
      // Random text doesn't compress: a few parts of 1 KiB.
      const noise = [...crypto.getRandomValues(new Uint8Array(3000))].map((b) => b.toString(36)).join("");
      agent.store.productivity.notes.create({ title: "Ruído", content: noise });
      const h = harness(agent);
      const key = await withKey(h.backup);
      h.at("2026-11-10T06:00:00Z");
      await h.backup.tick();
      expect(h.bucket.calls.CreateMultipartUpload).toBe(1);
      expect(h.bucket.calls.UploadPart).toBeGreaterThan(2);
      expect(h.bucket.calls.CompleteMultipartUpload).toBe(1);
      expect(h.bucket.calls.PutObject).toBeUndefined();
      const [stored] = [...h.bucket.objects.values()];
      expect(JSON.parse(await opened(stored?.bytes ?? new Uint8Array(), key)).data.notes[0].content).toBe(noise);
    }));

  it(`keeps the newest ${BACKUP_COPIES_KEPT}: the 8th copy deletes the 1st`, () =>
    inOwner(async (agent) => {
      const h = harness(agent);
      await withKey(h.backup);
      const names: string[] = [];
      for (let day = 10; day < 18; day++) {
        h.at(`2026-11-${day}T06:00:00Z`);
        await h.backup.tick();
        names.push([...h.bucket.objects.keys()].find((name) => !names.includes(name)) ?? "");
      }
      expect(names.every((name) => name.length > 0)).toBe(true);
      expect(h.bucket.objects.size).toBe(BACKUP_COPIES_KEPT);
      expect(h.bucket.objects.has(names[0] ?? "")).toBe(false);
      expect(h.bucket.objects.has(names[1] ?? "")).toBe(true);
      expect(h.bucket.calls.DeleteObject).toBe(1);
      const status = await h.backup.status();
      expect(status.copies.map((copy) => `zuri/${copy.name}.zuri`)).toEqual(names.slice(1).reverse());
      // R2 per run: one write and one list; deleting is free. A month stays far inside the free tier.
      expect(h.bucket.calls.PutObject).toBe(8);
      expect(h.bucket.calls.ListObjects).toBe(8 + 1);
    }));

  it("deletes nothing when the upload fails, tries again in an hour, three times a day", () =>
    inOwner(async (agent) => {
      const h = harness(agent);
      await withKey(h.backup);
      for (let day = 10; day < 17; day++) {
        h.at(`2026-11-${day}T06:00:00Z`);
        await h.backup.tick();
      }
      const before = [...h.bucket.objects.keys()];
      h.bucket.failOn.add("PutObject");
      h.at("2026-11-17T06:00:00Z");
      expect(await h.backup.tick()).toBe(true);
      expect([...h.bucket.objects.keys()]).toEqual(before);
      expect(h.bucket.calls.DeleteObject).toBeUndefined();
      let status = await h.backup.status();
      expect(status.failure?.at).toBe("2026-11-17T06:00:00.000Z");
      expect(status.nextAt).toBe("2026-11-17T07:00:00.000Z");
      h.at("2026-11-17T07:00:00Z");
      await h.backup.tick();
      h.at("2026-11-17T08:00:00Z");
      await h.backup.tick();
      // The third try of the day failed: the next is the next day's slot.
      status = await h.backup.status();
      expect(status.nextAt).toBe("2026-11-18T06:00:00.000Z");
      h.bucket.failOn.clear();
      h.at("2026-11-18T06:00:00Z");
      await h.backup.tick();
      status = await h.backup.status();
      expect(status.failure).toBeNull();
      expect(status.copies).toHaveLength(BACKUP_COPIES_KEPT);
    }));

  it("aborts a multipart upload that fails half way, and leaves the old copies", () =>
    inOwner(async (agent) => {
      const noise = [...crypto.getRandomValues(new Uint8Array(3000))].map((b) => b.toString(36)).join("");
      agent.store.productivity.notes.create({ title: "Ruído", content: noise });
      const h = harness(agent);
      await withKey(h.backup);
      h.bucket.failOn.add("CompleteMultipartUpload");
      h.at("2026-11-10T06:00:00Z");
      await h.backup.tick();
      expect(h.bucket.calls.AbortMultipartUpload).toBe(1);
      expect(h.bucket.objects.size).toBe(0);
      expect((await h.backup.status()).failure).not.toBeNull();
      // A part refused half way is aborted the same way, before the rest is sent.
      h.bucket.failOn.clear();
      h.bucket.failOn.add("UploadPart");
      h.at("2026-11-10T07:00:00Z");
      await h.backup.tick();
      expect(h.bucket.calls.AbortMultipartUpload).toBe(2);
      expect(h.bucket.calls.CompleteMultipartUpload).toBe(1);
      expect(h.bucket.objects.size).toBe(0);
    }));

  it("writes the try down before uploading, so a run cut short comes back in an hour and not in a loop", () =>
    inOwner(async (agent) => {
      let seen: unknown = null;
      const h = harness(agent, {
        source: function* () {
          // The middle of the run: what the alarm would find if the object died here.
          seen = JSON.parse(new InternalState(agent.store.db).get<string>("backup") ?? "{}");
          yield '{"format":"zuri-backup"}';
        },
      });
      await withKey(h.backup);
      h.at("2026-11-10T06:00:00Z");
      await h.backup.tick();
      expect(seen).toMatchObject({ nextAt: "2026-11-10T07:00:00.000Z", tries: "2026-11-10|1" });
      // The copy worked: the next is tomorrow's, and the day's tries start over.
      expect((await h.backup.status()).nextAt).toBe("2026-11-11T06:00:00.000Z");
    }));

  it(`stops a run past ${BACKUP_R2_CALLS_PER_RUN} R2 calls as a failure, aborting the upload`, () =>
    inOwner(async (agent) => {
      const noise = [...crypto.getRandomValues(new Uint8Array(6000))].map((b) => b.toString(36)).join("");
      agent.store.productivity.notes.create({ title: "Ruído", content: noise });
      // Parts of 16 bytes: a few hundred of them, far past the cap.
      const h = harness(agent, { partBytes: 16 });
      await withKey(h.backup);
      h.at("2026-11-10T06:00:00Z");
      await h.backup.tick();
      const calls = Object.values(h.bucket.calls).reduce((sum, n) => sum + n, 0);
      expect(calls).toBeLessThanOrEqual(BACKUP_R2_CALLS_PER_RUN + 1);
      expect(h.bucket.calls.AbortMultipartUpload).toBe(1);
      expect(h.bucket.objects.size).toBe(0);
      expect((await h.backup.status()).failure).not.toBeNull();
    }));

  it("keeps the newest copy of an earlier key for 30 days, so a key changed by someone else can't wipe the owner's copies in a week", () =>
    inOwner(async (agent) => {
      const h = harness(agent);
      await withKey(h.backup);
      for (let day = 10; day < 17; day++) {
        h.at(`2026-11-${day}T06:00:00Z`);
        await h.backup.tick();
      }
      const oldNewest = [...h.bucket.objects.entries()].sort((a, b) => b[1].uploaded.getTime() - a[1].uploaded.getTime())[0]?.[0] ?? "";
      // Another key, then a week and more of copies with it.
      await withKey(h.backup);
      for (let day = 17; day < 26; day++) {
        h.at(`2026-11-${day}T06:00:00Z`);
        await h.backup.tick();
      }
      expect(h.bucket.objects.size).toBe(BACKUP_COPIES_KEPT + 1);
      expect(h.bucket.objects.has(oldNewest)).toBe(true);
      // Past its 30 days it goes like any other.
      h.at("2026-12-17T06:00:00Z");
      await h.backup.tick();
      expect(h.bucket.objects.has(oldNewest)).toBe(false);
      expect(h.bucket.objects.size).toBe(BACKUP_COPIES_KEPT);
    }));

  it("says when the list of copies couldn't be read, instead of showing none", () =>
    inOwner(async (agent) => {
      const h = harness(agent);
      await withKey(h.backup);
      h.at("2026-11-10T06:00:00Z");
      await h.backup.tick();
      expect((await h.backup.status()).listFailed).toBe(false);
      h.bucket.failOn.add("ListObjects");
      expect(await h.backup.status()).toMatchObject({ listFailed: true, copies: [] });
    }));

  it("uploads even in a wake out of places (R2 isn't an external call), and leaves the month's Telegram send for the next copy", () =>
    inOwner(async (agent) => {
      const h = harness(agent);
      h.withChat();
      await withKey(h.backup);
      h.at("2026-11-10T06:00:00Z");
      const full = new WakeBudget(12, 10);
      full.take(2);
      await inWake(full, () => h.backup.tick());
      expect(h.bucket.objects.size).toBe(1);
      expect(full.used).toBe(2);
      expect(h.sent).toEqual([]);
      h.at("2026-11-11T06:00:00Z");
      const roomy = new WakeBudget();
      await inWake(roomy, () => h.backup.tick());
      // Only Telegram's send took a place.
      expect(roomy.used).toBe(1);
      expect(h.sent.map((s) => s.method)).toEqual(["sendDocument"]);
    }));

  it("refuses a public key that isn't P-256 or doesn't match its id", () =>
    inOwner(async (agent) => {
      const h = harness(agent);
      const { publicKey, file } = await createBackupKey();
      const other = await createBackupKey();
      await expect(h.backup.setKey({ key: other.file.key, publicKey })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(h.backup.setKey({ key: file.key, publicKey: `C${publicKey.slice(1)}` })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      expect((await h.backup.status()).key).toBeNull();
    }));
});

describe("Telegram: the month's copy and the 30-day warning", () => {
  it("sends the month's first copy that works, once a month, only to the owner's chat, and counts it as taken out", () =>
    inOwner(async (agent) => {
      const h = harness(agent);
      h.withChat();
      await withKey(h.backup);
      h.at("2026-11-10T06:00:00Z");
      await h.backup.tick();
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]).toMatchObject({ method: "sendDocument", chat: 4242, filename: expect.stringMatching(/^2026-11-10-[0-9a-f]{8}\.zuri$/) });
      expect(h.sent[0]?.text).toContain("cifrado");
      expect((await h.backup.status()).downloadedAt).toBe("2026-11-10T06:00:00.000Z");
      // The rest of the month, nothing more.
      h.at("2026-11-30T06:00:00Z");
      await h.backup.tick();
      expect(h.sent).toHaveLength(1);
      h.at("2026-12-01T06:00:00Z");
      await h.backup.tick();
      expect(h.sent).toHaveLength(2);
      expect(h.sent[1]?.filename).toMatch(/^2026-12-01-/);
    }));

  it("tries the month's send again with the next day's copy when Telegram fails", () =>
    inOwner(async (agent) => {
      const h = harness(agent);
      h.withChat();
      await withKey(h.backup);
      h.telegramDown(true);
      h.at("2026-12-01T06:00:00Z");
      await h.backup.tick();
      expect(h.bucket.objects.size).toBe(1);
      expect(h.sent).toEqual([]);
      expect((await h.backup.status()).downloadedAt).toBeNull();
      h.telegramDown(false);
      h.at("2026-12-02T06:00:00Z");
      await h.backup.tick();
      expect(h.sent.map((s) => s.filename)).toEqual([expect.stringMatching(/^2026-12-02-/)]);
    }));

  it("sends only a message when the copy is too big, nothing without the linked bot or during a lockdown", () =>
    inOwner(async (agent) => {
      const big = harness(agent, { telegramMaxBytes: 10 });
      big.withChat();
      await withKey(big.backup);
      big.at("2026-12-01T06:00:00Z");
      await big.backup.tick();
      expect(big.sent.map((s) => s.method)).toEqual(["sendMessage"]);
      expect(big.sent[0]?.text).toContain("40 MB");
      big.state.delete("backup");

      const locked = harness(agent);
      locked.withChat();
      await withKey(locked.backup);
      locked.lock(true);
      locked.at("2026-12-01T06:00:00Z");
      await locked.backup.tick();
      expect(locked.sent).toEqual([]);
      locked.state.delete("backup");

      const alone = harness(agent);
      await withKey(alone.backup);
      alone.noChat();
      alone.at("2026-12-01T06:00:00Z");
      await alone.backup.tick();
      expect(alone.sent).toEqual([]);
      expect(alone.bucket.objects.size).toBe(1);
    }));

  it("warns once the last backup taken out is more than 30 days old (the 31st day), then each 30 days", () =>
    inOwner(async (agent) => {
      const h = harness(agent, { bucket: () => null });
      h.withChat();
      // Never downloaded: from the first sign-in. Exactly 30 days isn't more than 30.
      h.at("2026-12-01T12:00:00Z");
      expect(await h.backup.tick()).toBe(false);
      h.at("2026-12-02T12:00:00Z");
      expect(await h.backup.tick()).toBe(true);
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.text).toMatch(/31 dias que você usa a Zuri/);
      expect(await h.backup.tick()).toBe(false);
      expect(h.backup.nextDue()).toBe("2027-01-01T12:00:00.000Z");
      // A download starts the count again.
      h.at("2026-12-05T12:00:00Z");
      h.backup.downloaded();
      expect(h.backup.nextDue()).toBe("2027-01-05T12:00:00.000Z");
      h.at("2027-01-05T12:00:00Z");
      await h.backup.tick();
      expect(h.sent[1]?.text).toMatch(/Faz 31 dias que você não baixa/);
      expect(h.backup.age().days).toBe(31);
    }));
});

describe("the screen's routes and /backup", () => {
  const install = (agent: ZuriAgent) => {
    const h = harness(agent);
    // The test's bucket and clock in place of the installation's (which has none).
    agent.store.backupAuto = h.backup;
    return h;
  };

  it("saves the key with the password just typed, raises an alert, lists and downloads a copy", async () => {
    const { publicKey, file } = await createBackupKey();
    await inOwner((agent) => agent.store.db.run(`UPDATE zur_sessions SET confirmed_at = ?`, Date.now() - 16 * 60_000));
    const stale = await session("PUT", "/backup/key", { key: file.key, publicKey });
    expect(stale.status).toBe(403);
    await fresh();
    await inOwner((agent) => {
      install(agent);
    });
    const bad = await session("PUT", "/backup/key", { key: file.key, publicKey: publicKey.slice(1) });
    expect(bad.status).toBe(400);
    expect((await errorBody(bad)).code).toBe("VALIDATION_FAILED");
    const saved = await session("PUT", "/backup/key", { key: file.key, publicKey });
    expect(saved.status).toBe(200);
    const alerts = await inOwner((agent) => agent.store.db.all<{ kind: string }>(`SELECT kind FROM zur_auth_events WHERE kind = 'backup_key_set'`));
    expect(alerts).toHaveLength(1);

    const name = await inOwner(async (agent) => {
      const h = install(agent);
      await h.backup.setKey({ key: file.key, publicKey });
      h.at("2026-11-10T06:00:00Z");
      await h.backup.tick();
      return (await h.backup.status()).copies[0]?.name ?? "";
    });
    const status = (await (await session("GET", "/backup/auto")).json()) as BackupAutoStatus;
    expect(status).toMatchObject({ available: true, key: { id: file.key }, copies: [{ name }] });

    const copy = await session("GET", `/backup/copies/${name}`);
    expect(copy.status).toBe(200);
    expect(copy.headers.get("content-disposition")).toBe(`attachment; filename="zuri-backup-${name}.zuri"`);
    const bytes = new Uint8Array(await copy.arrayBuffer());
    expect(JSON.parse(await opened(bytes, file)).format).toBe("zuri-backup");
    for (const wrong of ["2026-11-10-zzzzzzzz", "..%2Fzuri", "2026-11-10-00000000"]) {
      expect((await session("GET", `/backup/copies/${wrong}`)).status).toBe(404);
    }
    const age = await inOwner((agent) => agent.store.backupAuto.age());
    expect(age.days).toBe(0);
  });

  it("answers /backup with the age, the last copy, or why it is off", () =>
    inOwner(async (agent) => {
      const h = install(agent);
      const text = () => agent.store.backupAuto.age();
      expect(text()).toMatchObject({ days: null, available: true, keySet: false });
      await withKey(h.backup);
      h.at("2026-11-10T06:00:00Z");
      await h.backup.tick();
      h.backup.downloaded();
      h.at("2026-11-12T06:00:00Z");
      expect(text()).toMatchObject({ days: 2, keySet: true, last: { at: "2026-11-10T06:00:00.000Z" } });
    }));

  it("answers 401 without a session and 423 during a lockdown, on every route of the automatic backup", async () => {
    const { publicKey, file } = await createBackupKey();
    const routes = [
      ["GET", "/backup/auto"],
      ["PUT", "/backup/key", { key: file.key, publicKey }],
      ["GET", "/backup/copies/2026-11-10-0a1b2c3d"],
    ] as const;
    for (const [method, path, body] of routes) {
      const res = await call(`${ORIGIN}/api${path}`, { method, headers: { ...CSRF, "content-type": "application/json", "cf-connecting-ip": IP }, ...(body ? { body: JSON.stringify(body) } : {}) });
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    await inOwner((agent) => {
      install(agent);
      return agent.store.auth.lockdown.mark("telegram:test");
    });
    try {
      for (const [method, path, body] of routes) {
        expect((await errorBody(await session(method, path, body))).code, `${method} ${path}`).toBe("LOCKDOWN_ACTIVE");
      }
      expect(await inOwner((agent) => agent.store.backupAuto.status().then((status) => status.key))).toBeNull();
    } finally {
      await inOwner((agent) => {
        const state = new InternalState(agent.store.db);
        for (const key of ["lockdown_until", "lockdown_source"] as const) state.delete(key);
      });
    }
  });

  it("the JSON download counts as a backup taken out", async () => {
    await inOwner((agent) => {
      install(agent);
    });
    const res = await session("GET", "/backup/export");
    expect(res.status).toBe(200);
    await res.arrayBuffer();
    const age = await inOwner((agent) => agent.store.backupAuto.age());
    expect(age.days).toBe(0);
  });
});
