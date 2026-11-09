import { AGENT_INSTANCE_NAME, BACKUP_COPIES_KEPT, type BackupAutoStatus, type BackupKeyFile, createBackupKey, openBackup } from "@zuri/shared";
import { runInDurableObject } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { inWake, WakeBudget } from "../src/agent/wake-budget.ts";
import type { ZuriAgent } from "../src/agent/zuri-agent.ts";
import { AutomaticBackup, type AutomaticBackupDeps } from "../src/backup/automatic.ts";
import { MemoryBucket } from "../src/backup/dev-bucket.ts";
import { exportBackup } from "../src/backup/export.ts";
import { InternalState } from "../src/db/internal-state.ts";
import type { TelegramClient } from "../src/telegram/client.ts";
import { call, CSRF, errorBody, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD, testEnv } from "./helpers.ts";

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
  cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-zuri_session="))?.split(";")[0] ?? "";
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
  let chat: number | null = 4242;
  let lockdown = false;
  const client = {
    sendMessage: async (id: number, text: string) => {
      sent.push({ method: "sendMessage", chat: id, text });
      return { message_id: 1 };
    },
    sendDocument: async (id: number, file: Blob, filename: string, caption: string) => {
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
    noChat: () => {
      chat = null;
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
      // Without the bucket only the 30-day warning has a time.
      expect(none.backup.nextDue()).toBe("2026-12-01T12:00:00.000Z");
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
    }));

  it("waits for a wake with room: no call is made in one that is out of places", () =>
    inOwner(async (agent) => {
      const h = harness(agent);
      await withKey(h.backup);
      h.at("2026-11-10T06:00:00Z");
      const budget = new WakeBudget(12, 10);
      await inWake(budget, () => h.backup.tick());
      expect(budget.short).toBe(true);
      expect(h.bucket.calls).toEqual({});
      expect((await h.backup.status()).failure).toBeNull();
      const roomy = new WakeBudget();
      await inWake(roomy, () => h.backup.tick());
      expect(h.bucket.objects.size).toBe(1);
      expect(roomy.used).toBe(2);
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
  it("sends the copy on the 1st, once a month, only to the owner's chat, and counts it as taken out", () =>
    inOwner(async (agent) => {
      const h = harness(agent);
      await withKey(h.backup);
      h.at("2026-11-30T06:00:00Z");
      await h.backup.tick();
      expect(h.sent).toEqual([]);
      h.at("2026-12-01T06:00:00Z");
      await h.backup.tick();
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]).toMatchObject({ method: "sendDocument", chat: 4242, filename: expect.stringMatching(/^2026-12-01-[0-9a-f]{8}\.zuri$/) });
      expect(h.sent[0]?.text).toContain("cifrado");
      expect((await h.backup.status()).downloadedAt).toBe("2026-12-01T06:00:00.000Z");
      // A second copy the same day (a new key, say) doesn't go again.
      await withKey(h.backup);
      h.at("2026-12-01T07:00:00Z");
      h.state.set("backup", JSON.stringify({ ...JSON.parse(h.state.get<string>("backup") ?? "{}"), nextAt: "2026-12-01T07:00:00.000Z" }));
      await h.backup.tick();
      expect(h.sent).toHaveLength(1);
    }));

  it("sends only a message when the copy is too big, nothing without the linked bot or during a lockdown", () =>
    inOwner(async (agent) => {
      const big = harness(agent, { telegramMaxBytes: 10 });
      await withKey(big.backup);
      big.at("2026-12-01T06:00:00Z");
      await big.backup.tick();
      expect(big.sent.map((s) => s.method)).toEqual(["sendMessage"]);
      expect(big.sent[0]?.text).toContain("50 MB");
      big.state.delete("backup");

      const locked = harness(agent);
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

  it("warns when the last backup taken out is over 30 days old, once each 30 days", () =>
    inOwner(async (agent) => {
      const h = harness(agent, { bucket: () => null });
      // Never downloaded: 30 days from the first sign-in.
      h.at("2026-12-01T11:59:00Z");
      expect(await h.backup.tick()).toBe(false);
      h.at("2026-12-01T12:00:00Z");
      expect(await h.backup.tick()).toBe(true);
      expect(h.sent).toHaveLength(1);
      expect(h.sent[0]?.text).toMatch(/30 dias que você usa a Zuri/);
      expect(await h.backup.tick()).toBe(false);
      expect(h.backup.nextDue()).toBe("2026-12-31T12:00:00.000Z");
      // A download starts the 30 days again.
      h.at("2026-12-05T12:00:00Z");
      h.backup.downloaded();
      expect(h.backup.nextDue()).toBe("2027-01-04T12:00:00.000Z");
      h.at("2027-01-04T12:00:00Z");
      await h.backup.tick();
      expect(h.sent[1]?.text).toMatch(/Faz 30 dias que você não baixa/);
      expect(h.backup.age().days).toBe(30);
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
