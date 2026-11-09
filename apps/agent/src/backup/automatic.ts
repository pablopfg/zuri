import {
  BACKUP_COPIES_KEPT,
  BACKUP_COPY_NAME,
  BACKUP_FILE_EXTENSION,
  BACKUP_HOUR,
  BACKUP_STALE_DAYS,
  BACKUP_TELEGRAM_MAX_BYTES,
  BACKUP_TRIES_PER_DAY,
  type BackupAutoStatus,
  type BackupKeyInput,
  backupKeyId,
  fromBase64Url,
  importBackupPublicKey,
  type Locale,
  nextRun,
  sealBackup,
  t,
  zonedParts,
} from "@zuri/shared";
import { currentWake } from "../agent/wake-budget.ts";
import type { InternalState } from "../db/internal-state.ts";
import { AppError } from "../http/errors.ts";
import { log } from "../log.ts";
import type { TelegramClient } from "../telegram/client.ts";

/** Where the copies live in the bucket; nothing else of the Zuri goes there. */
export const BACKUP_PREFIX = "zuri/";
/** Bytes per part of a multipart upload: R2 wants at least 5 MiB, and every part but the last the same size. */
export const BACKUP_PART_BYTES = 8 * 1024 * 1024;
/** Text handed to gzip at a time: one record per write would cost more in calls than in bytes. */
const FEED_BYTES = 64 * 1024;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;
/** A file of up to 50 MB to Telegram: much more than a message's 10 seconds. */
const TELEGRAM_UPLOAD_TIMEOUT_MS = 120_000;

/** The part of R2's binding the backup uses: tests answer it in memory. */
export type BackupBucket = Pick<R2Bucket, "put" | "get" | "list" | "delete" | "createMultipartUpload">;

interface Stored {
  publicKey?: string;
  key?: string;
  keyAt?: string;
  nextAt?: string;
  /** "<local day>|<tries>": the tries of that day. */
  tries?: string;
  last?: { at: string; size: number };
  failureAt?: string | undefined;
  downloadedAt?: string;
  warnedAt?: string;
  /** "YYYY-MM" of the last copy sent to Telegram (or its message, when too big). */
  telegramMonth?: string;
}

export interface AutomaticBackupDeps {
  state: InternalState;
  /** The BACKUP_BUCKET binding, or null where the installation has none (⚠ optional). */
  bucket(): BackupBucket | null;
  /** The backup's JSON, piece by piece (exportBackup). */
  source(): Iterable<string>;
  timeZone(): string;
  locale(): Locale;
  /** PUBLIC_URL's origin, for the button to the screen. */
  origin(): string;
  lockdown(): boolean;
  /** When the owner first signed in (ms): the 30 days of a backup never taken count from there. */
  firstSignIn(): number | null;
  telegram: {
    /** The owner's private chat when the bot is set up and linked to TELEGRAM_ADMIN_ID, or null. */
    chat(): number | null;
    client(options: { timeoutMs?: number }): TelegramClient;
  };
  now?(): Date;
  /** Tests upload small parts (R2's own minimum is 5 MiB). */
  partBytes?: number;
  /** Tests lower the size above which the month's copy goes as a message only. */
  telegramMaxBytes?: number;
}

class NoRoom extends Error {
  constructor() {
    super("no room in this wake");
    this.name = "NoRoom";
  }
}

/**
 * The automatic backup (step 23b, decision of 02/11/2026 ⚠ R2): once a day,
 * from 3 a.m. in the owner's time zone, the manual backup's JSON is
 * compressed, sealed with the owner's public key and uploaded to the bucket;
 * only after the upload is confirmed are copies past the newest 7 deleted.
 * A failed upload is aborted and deletes nothing. On the 1st of each month
 * the copy also goes to the owner's private chat with the bot, and the bot
 * says when the last backup taken out is more than 30 days old.
 */
export class AutomaticBackup {
  constructor(private readonly deps: AutomaticBackupDeps) {}

  #now(): Date {
    return this.deps.now?.() ?? new Date();
  }

  #read(): Stored {
    const raw = this.deps.state.get<string>("backup");
    if (typeof raw !== "string") return {};
    try {
      const parsed = JSON.parse(raw) as unknown;
      return parsed && typeof parsed === "object" ? (parsed as Stored) : {};
    } catch {
      return {};
    }
  }

  #write(patch: Partial<Stored>): Stored {
    const next = { ...this.#read(), ...patch };
    this.deps.state.set("backup", JSON.stringify(next));
    return next;
  }

  /** The next local BACKUP_HOUR after `after`. */
  #nextSlot(after: Date): string {
    const at = nextRun({ type: "daily", time: `${String(BACKUP_HOUR).padStart(2, "0")}:00` }, this.deps.timeZone(), after);
    return (at ?? new Date(after.getTime() + DAY_MS)).toISOString();
  }

  #localDay(at: Date): string {
    const p = zonedParts(at, this.deps.timeZone());
    return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
  }

  /** Saves the public key the browser made; the private one never comes here. */
  async setKey(input: BackupKeyInput): Promise<{ id: string; createdAt: string }> {
    const key = await importBackupPublicKey(input.publicKey);
    if (!key || (await backupKeyId(fromBase64Url(input.publicKey))) !== input.key) {
      throw new AppError("VALIDATION_FAILED", "error.backup.key", { fields: ["publicKey"] });
    }
    const createdAt = this.#now().toISOString();
    // A new key: the next copy goes with it at the next slot, the old ones keep opening with the old file.
    this.#write({ publicKey: input.publicKey, key: input.key, keyAt: createdAt, nextAt: this.#nextSlot(this.#now()) });
    return { id: input.key, createdAt };
  }

  /** When the alarm should come back for the backup, or null when it has nothing to do. */
  nextDue(): string | null {
    const stored = this.#read();
    const times: string[] = [];
    if (this.deps.bucket() && stored.publicKey) times.push(stored.nextAt ?? this.#nextSlot(this.#now()));
    const warn = this.#warnDue(stored);
    if (warn !== null) times.push(new Date(warn).toISOString());
    return times.sort()[0] ?? null;
  }

  /** The owner took a backup out (the file, a copy or Telegram's): the 30 days start again. */
  downloaded(): void {
    this.#write({ downloadedAt: this.#now().toISOString() });
  }

  /** The alarm's share: the day's copy when due, then the 30-day warning. True when the alarm should be set again. */
  async tick(): Promise<boolean> {
    let moved = false;
    const stored = this.#read();
    const bucket = this.deps.bucket();
    const now = this.#now();
    if (bucket && stored.publicKey) {
      const due = stored.nextAt ?? this.#nextSlot(now);
      if (!stored.nextAt) this.#write({ nextAt: due });
      if (Date.parse(due) <= now.getTime()) {
        await this.#run(bucket, stored.publicKey);
        moved = true;
      }
    }
    if (await this.#warn()) moved = true;
    return moved;
  }

  async #run(bucket: BackupBucket, publicKey: string): Promise<void> {
    const now = this.#now();
    const day = this.#localDay(now);
    const [triedDay, triedCount] = (this.#read().tries ?? "").split("|");
    const tries = triedDay === day ? Number(triedCount) || 0 : 0;
    try {
      const copy = await this.#upload(bucket, publicKey, day);
      const at = this.#now().toISOString();
      this.#write({ last: { at, size: copy.size }, failureAt: undefined, tries: `${day}|0`, nextAt: this.#nextSlot(this.#now()) });
      log("info", "backup_auto_done");
      await this.#prune(bucket);
      await this.#monthly(bucket, copy);
    } catch (error) {
      if (error instanceof NoRoom) {
        // Nothing went out: the next wake, a minute away, tries again (the wake budget's `short`).
        return;
      }
      const used = tries + 1;
      log("error", "backup_auto_failed", { error, count: used });
      // A try an hour later, three a day at most; then the next day's slot.
      const retry = used < BACKUP_TRIES_PER_DAY ? new Date(now.getTime() + HOUR_MS).toISOString() : this.#nextSlot(now);
      this.#write({ failureAt: this.#now().toISOString(), tries: `${day}|${used}`, nextAt: retry });
    }
  }

  /** Takes one place in this wake's count of calls; an R2 call through the binding counts as one. */
  #take(n = 1): void {
    const budget = currentWake();
    if (budget && !budget.take(n)) throw new NoRoom();
  }

  async #upload(bucket: BackupBucket, publicKey: string, day: string): Promise<{ key: string; size: number }> {
    // Every call this run can make, up front: the list, the upload's parts by the last size, the prune and Telegram's two.
    const lastSize = this.#read().last?.size ?? 0;
    const partBytes = this.deps.partBytes ?? BACKUP_PART_BYTES;
    const parts = Math.max(1, Math.ceil((lastSize * 1.5) / partBytes));
    const budget = currentWake();
    if (budget && !budget.room(parts + 2 + 2 + 2)) throw new NoRoom();

    const random = [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
    const key = `${BACKUP_PREFIX}${day}-${random}${BACKUP_FILE_EXTENSION}`;
    const sealed = sealBackup(gzipped(this.deps.source()), publicKey);

    let upload: R2MultipartUpload | null = null;
    const uploaded: R2UploadedPart[] = [];
    let part = new Uint8Array(partBytes);
    let filled = 0;
    let size = 0;
    try {
      for await (const frame of sealed) {
        let offset = 0;
        while (offset < frame.length) {
          const take = Math.min(partBytes - filled, frame.length - offset);
          part.set(frame.subarray(offset, offset + take), filled);
          filled += take;
          offset += take;
          size += take;
          if (filled === partBytes) {
            if (!upload) {
              this.#take();
              upload = await bucket.createMultipartUpload(key, { httpMetadata: { contentType: "application/octet-stream" } });
            }
            this.#take();
            uploaded.push(await upload.uploadPart(uploaded.length + 1, part));
            part = new Uint8Array(partBytes);
            filled = 0;
          }
        }
      }
      if (!upload) {
        this.#take();
        await bucket.put(key, part.subarray(0, filled), { httpMetadata: { contentType: "application/octet-stream" } });
      } else {
        if (filled > 0) {
          this.#take();
          uploaded.push(await upload.uploadPart(uploaded.length + 1, part.subarray(0, filled)));
        }
        this.#take();
        await upload.complete(uploaded);
      }
    } catch (error) {
      // An upload left open is aborted; nothing of the old copies was touched.
      if (upload) {
        const open = upload;
        const budgetForAbort = currentWake();
        if (!budgetForAbort || budgetForAbort.take(1, true)) await open.abort().catch(() => undefined);
      }
      throw error;
    }
    return { key, size };
  }

  /** Copies past the newest BACKUP_COPIES_KEPT are deleted, only ever after an upload that worked. */
  async #prune(bucket: BackupBucket): Promise<void> {
    try {
      const copies = await this.#list(bucket);
      const old = copies.slice(BACKUP_COPIES_KEPT).map((copy) => copy.key);
      if (old.length === 0) return;
      this.#take();
      await bucket.delete(old);
    } catch (error) {
      // The copy is safe; the extra ones go at the next run.
      log("warn", "backup_auto_failed", { error, kind: "prune" });
    }
  }

  async #list(bucket: BackupBucket): Promise<{ key: string; size: number; uploaded: Date }[]> {
    this.#take();
    const listed = await bucket.list({ prefix: BACKUP_PREFIX, limit: 1000 });
    return listed.objects
      .filter((object) => object.key.endsWith(BACKUP_FILE_EXTENSION) && BACKUP_COPY_NAME.test(copyName(object.key) ?? ""))
      .map((object) => ({ key: object.key, size: object.size, uploaded: object.uploaded }))
      .sort((a, b) => b.uploaded.getTime() - a.uploaded.getTime() || (a.key < b.key ? 1 : -1));
  }

  /** On the 1st of the month (local), the copy goes to the owner's private chat once; a file too big goes as a message. */
  async #monthly(bucket: BackupBucket, copy: { key: string; size: number }): Promise<void> {
    const now = this.#now();
    const parts = zonedParts(now, this.deps.timeZone());
    const month = `${parts.year}-${String(parts.month).padStart(2, "0")}`;
    if (parts.day !== 1 || this.#read().telegramMonth === month || this.deps.lockdown()) return;
    const chat = this.deps.telegram.chat();
    if (chat === null) return;
    const locale = this.deps.locale();
    const name = copyName(copy.key) ?? "backup";
    try {
      const client = this.deps.telegram.client({ timeoutMs: TELEGRAM_UPLOAD_TIMEOUT_MS });
      if (copy.size > (this.deps.telegramMaxBytes ?? BACKUP_TELEGRAM_MAX_BYTES)) {
        this.#take();
        await client.sendMessage(chat, t(locale, "telegram.backup.tooBig"), { reply_markup: this.#button(locale) });
      } else {
        this.#take(2);
        const object = await bucket.get(copy.key);
        if (!object) return;
        await client.sendDocument(chat, new Blob([await object.arrayBuffer()]), `${name}${BACKUP_FILE_EXTENSION}`, t(locale, "telegram.backup.monthly"));
        this.#write({ downloadedAt: this.#now().toISOString() });
      }
      this.#write({ telegramMonth: month });
    } catch (error) {
      if (error instanceof NoRoom) return;
      log("warn", "backup_telegram_failed", { error });
    }
  }

  #button(locale: Locale) {
    return { inline_keyboard: [[{ text: t(locale, "telegram.chat.openInApp"), url: `${this.deps.origin()}/configuracoes/dados` }]] };
  }

  /** When the 30-day warning is due (ms), or null: once each 30 days while no backup is taken out. */
  #warnDue(stored: Stored): number | null {
    const since = stored.downloadedAt ? Date.parse(stored.downloadedAt) : this.deps.firstSignIn();
    if (since === null || Number.isNaN(since)) return null;
    const warned = stored.warnedAt ? Date.parse(stored.warnedAt) : 0;
    const due = Math.max(since, warned) + BACKUP_STALE_DAYS * DAY_MS;
    return due;
  }

  async #warn(): Promise<boolean> {
    const stored = this.#read();
    const due = this.#warnDue(stored);
    if (due === null || due > this.#now().getTime() || this.deps.lockdown()) return false;
    const chat = this.deps.telegram.chat();
    // Without the bot there is no one to tell: the screen shows the age, and the warning waits.
    if (chat === null) return false;
    const locale = this.deps.locale();
    const since = stored.downloadedAt ? Date.parse(stored.downloadedAt) : this.deps.firstSignIn();
    const days = Math.floor((this.#now().getTime() - (since ?? 0)) / DAY_MS);
    try {
      this.#take();
      await this.deps.telegram.client({}).sendMessage(chat, t(locale, stored.downloadedAt ? "telegram.backup.stale" : "telegram.backup.never", { days }), { reply_markup: this.#button(locale) });
      this.#write({ warnedAt: this.#now().toISOString() });
      return true;
    } catch (error) {
      if (error instanceof NoRoom) return false;
      log("warn", "backup_telegram_failed", { error, kind: "warning" });
      // Not again in this wake loop: an hour later.
      this.#write({ warnedAt: new Date(this.#now().getTime() - BACKUP_STALE_DAYS * DAY_MS + HOUR_MS).toISOString() });
      return true;
    }
  }

  /** The screen's card. Lists the bucket once (a Class A operation, only when the owner opens it). */
  async status(): Promise<BackupAutoStatus> {
    const stored = this.#read();
    const bucket = this.deps.bucket();
    let copies: BackupAutoStatus["copies"] = [];
    if (bucket) {
      try {
        copies = (await this.#list(bucket)).map((copy) => ({ name: copyName(copy.key) ?? "", size: copy.size, at: copy.uploaded.toISOString() }));
      } catch (error) {
        log("warn", "backup_auto_failed", { error, kind: "list" });
      }
    }
    return {
      available: bucket !== null,
      key: stored.key && stored.keyAt ? { id: stored.key, createdAt: stored.keyAt } : null,
      copies,
      last: stored.last ?? null,
      failure: stored.failureAt ? { at: stored.failureAt } : null,
      nextAt: bucket && stored.publicKey ? (stored.nextAt ?? this.#nextSlot(this.#now())) : null,
      downloadedAt: stored.downloadedAt ?? null,
    };
  }

  /** One copy's bytes for the owner's download; counts as a backup taken out. */
  async download(name: string): Promise<R2ObjectBody> {
    const bucket = this.deps.bucket();
    if (!bucket) throw new AppError("NOT_CONFIGURED", "error.backup.noBucket");
    if (!BACKUP_COPY_NAME.test(name)) throw new AppError("NOT_FOUND");
    const object = await bucket.get(`${BACKUP_PREFIX}${name}${BACKUP_FILE_EXTENSION}`);
    if (!object) throw new AppError("NOT_FOUND");
    this.downloaded();
    return object;
  }

  /** The age of the last backup taken out, for /backup: days, or null when none ever was. */
  age(): { days: number | null; last: { at: string; size: number } | null; available: boolean; keySet: boolean } {
    const stored = this.#read();
    const days = stored.downloadedAt ? Math.floor((this.#now().getTime() - Date.parse(stored.downloadedAt)) / DAY_MS) : null;
    return { days, last: stored.last ?? null, available: this.deps.bucket() !== null, keySet: Boolean(stored.publicKey) };
  }
}

/** "zuri/2026-11-09-0a1b2c3d.zuri" → "2026-11-09-0a1b2c3d". */
export function copyName(key: string): string | null {
  if (!key.startsWith(BACKUP_PREFIX) || !key.endsWith(BACKUP_FILE_EXTENSION)) return null;
  return key.slice(BACKUP_PREFIX.length, -BACKUP_FILE_EXTENSION.length);
}

/** The JSON pieces through gzip, in pieces of FEED_BYTES. */
async function* gzipped(source: Iterable<string>): AsyncGenerator<Uint8Array> {
  const gzip = new CompressionStream("gzip");
  const writer = gzip.writable.getWriter();
  const encoder = new TextEncoder();
  const feeding = (async () => {
    try {
      let batch = "";
      for (const piece of source) {
        batch += piece;
        if (batch.length >= FEED_BYTES) {
          await writer.write(encoder.encode(batch));
          batch = "";
        }
      }
      if (batch) await writer.write(encoder.encode(batch));
      await writer.close();
    } catch (error) {
      await writer.abort(error).catch(() => undefined);
      throw error;
    }
  })();
  // The reading side's failure would leave the feeding one waiting: it is awaited after.
  feeding.catch(() => undefined);
  const reader = gzip.readable.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
  await feeding;
}
