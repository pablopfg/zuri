import { describe, expect, it } from "vitest";
import {
  BACKUP_FILE_CHUNK,
  BACKUP_FILE_MAGIC,
  BackupFileError,
  backupFileKey,
  backupImportParts,
  backupKeyId,
  createBackupKey,
  importBackupPublicKey,
  isBackupEnvelope,
  openBackup,
  parseBackupKeyFile,
  sealBackup,
} from "../src/backup-file.ts";
import { fromBase64Url } from "../src/crypto.ts";

async function* pieces(...parts: Uint8Array[]): AsyncGenerator<Uint8Array> {
  for (const part of parts) yield part;
}

async function seal(publicKey: string, ...parts: Uint8Array[]): Promise<Uint8Array> {
  const out: Uint8Array[] = [];
  for await (const piece of sealBackup(pieces(...parts), publicKey)) out.push(piece);
  const file = new Uint8Array(out.reduce((sum, p) => sum + p.length, 0));
  let at = 0;
  for (const p of out) {
    file.set(p, at);
    at += p.length;
  }
  return file;
}

/** Byte for byte; `toEqual` walks a megabyte array one element at a time. */
const same = (a: Uint8Array, b: Uint8Array) => a.length === b.length && a.every((byte, i) => byte === b[i]);

const filled = (length: number, seed = 7) => Uint8Array.from({ length }, (_, i) => (i * 31 + seed) % 251);

async function reason(work: Promise<unknown>): Promise<string> {
  try {
    await work;
    return "opened";
  } catch (error) {
    return error instanceof BackupFileError ? error.reason : String(error);
  }
}

describe("the automatic backup's file (step 23b)", () => {
  it("opens with its key what was sealed, for an empty stream, one byte, exact frames and frames plus a byte", async () => {
    const { publicKey, file: key } = await createBackupKey(new Date("2026-11-09T12:00:00Z"));
    expect(key.key).toBe(await backupKeyId(fromBase64Url(publicKey)));
    expect(key.createdAt).toBe("2026-11-09T12:00:00.000Z");
    for (const size of [0, 1, BACKUP_FILE_CHUNK, 2 * BACKUP_FILE_CHUNK, 2 * BACKUP_FILE_CHUNK + 1]) {
      const plain = filled(size);
      // Uneven pieces, as the gzip stream gives them.
      const parts = [plain.subarray(0, Math.floor(size / 3)), plain.subarray(Math.floor(size / 3))];
      const sealed = await seal(publicKey, ...parts);
      expect(new TextDecoder().decode(sealed.subarray(0, BACKUP_FILE_MAGIC.length))).toBe(BACKUP_FILE_MAGIC);
      expect(backupFileKey(sealed)).toBe(key.key);
      expect(same(await openBackup(sealed, key), plain)).toBe(true);
    }
  });

  it("never opens with another key, or a changed, cut or extended file", async () => {
    const { publicKey, file: key } = await createBackupKey();
    const other = (await createBackupKey()).file;
    const sealed = await seal(publicKey, filled(BACKUP_FILE_CHUNK + 10));
    expect(await reason(openBackup(sealed, other))).toBe("key");
    // The other key under this file's id: the header matches, the frames don't.
    expect(await reason(openBackup(sealed, { ...other, key: key.key }))).toBe("damaged");

    const changed = sealed.slice();
    changed[changed.length - 5] = (changed[changed.length - 5] ?? 0) ^ 1;
    expect(await reason(openBackup(changed, key))).toBe("damaged");
    // Cut after the first frame: that frame was sealed as "not the last".
    const header = sealed.indexOf(10, BACKUP_FILE_MAGIC.length) + 1;
    const first = 4 + new DataView(sealed.buffer, header, 4).getUint32(0);
    expect(await reason(openBackup(sealed.slice(0, header + first), key))).toBe("damaged");
    expect(await reason(openBackup(sealed.slice(0, sealed.length - 1), key))).toBe("damaged");
    const extended = new Uint8Array(sealed.length + 1);
    extended.set(sealed);
    expect(await reason(openBackup(extended, key))).toBe("damaged");
    // The header is in every frame's additional data: a changed salt or key id doesn't open either.
    const text = new TextDecoder().decode(sealed.subarray(0, header));
    const swapped = new TextEncoder().encode(text.replace(/"salt":"./, (m) => m.slice(0, -1) + (m.endsWith("A") ? "B" : "A")));
    const forged = new Uint8Array(swapped.length + sealed.length - header);
    forged.set(swapped);
    forged.set(sealed.subarray(header), swapped.length);
    expect(await reason(openBackup(forged, key))).toBe("damaged");
    expect(await reason(openBackup(sealed.subarray(0, header), key))).toBe("damaged");
  });

  it("refuses what isn't a backup file or a key file", async () => {
    const { file: key } = await createBackupKey();
    expect(await reason(openBackup(new TextEncoder().encode('{"format":"zuri-backup"}'), key))).toBe("format");
    expect(await reason(openBackup(new TextEncoder().encode(`${BACKUP_FILE_MAGIC}not json\n`), key))).toBe("format");
    expect(await reason(openBackup(new TextEncoder().encode(`${BACKUP_FILE_MAGIC}${"x".repeat(600)}`), key))).toBe("format");
    expect(backupFileKey(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(parseBackupKeyFile(JSON.stringify(key))).toEqual(key);
    for (const text of ["", "null", "{}", JSON.stringify({ ...key, format: "other" }), JSON.stringify({ ...key, privateKey: { ...key.privateKey, d: undefined } })]) {
      expect(() => parseBackupKeyFile(text)).toThrow(BackupFileError);
    }
  });

  it("takes only an uncompressed P-256 public key", async () => {
    const { publicKey } = await createBackupKey();
    expect(await importBackupPublicKey(publicKey)).not.toBeNull();
    expect(await importBackupPublicKey(publicKey.slice(0, -2))).toBeNull();
    expect(await importBackupPublicKey("not base64url!")).toBeNull();
    expect(await importBackupPublicKey("A".repeat(87))).toBeNull();
    await expect(reason(seal("nope"))).resolves.toBe("key");
  });
});

describe("restoring a big backup in parts", () => {
  const head = { format: "zuri-backup", version: 1, schema: 31, exportedAt: "2026-11-09T00:00:00.000Z" };
  const conversation = (i: number) => ({ id: `c${i}`, title: `Conversa ${i}`, messages: [{ role: "user", content: "x".repeat(300) }] });

  it("sends a backup under the limit whole", () => {
    const backup = { ...head, data: { notes: [{ id: "n1" }], conversations: [conversation(1)] } };
    expect(backupImportParts(backup, 10_000)).toEqual([backup]);
  });

  it("sends the rest first, then the conversations in batches that each fit, losing none", () => {
    const conversations = Array.from({ length: 40 }, (_, i) => conversation(i));
    const backup = { ...head, data: { settings: { timeZone: "America/Sao_Paulo" }, notes: [{ id: "n1" }], conversations } };
    const max = 2_000;
    const parts = backupImportParts(backup, max);
    expect(parts[0]?.data).toEqual({ settings: { timeZone: "America/Sao_Paulo" }, notes: [{ id: "n1" }], conversations: [] });
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts.slice(1)) {
      expect(new TextEncoder().encode(JSON.stringify(part)).length).toBeLessThanOrEqual(max);
      expect(Object.keys(part.data)).toEqual(["conversations"]);
      expect(part).toMatchObject(head);
    }
    expect(parts.slice(1).flatMap((part) => part.data.conversations)).toEqual(conversations);
  });
});

describe("backupImportParts when the rest alone is too big", () => {
  const head = { format: "zuri-backup", version: 1, schema: 1, exportedAt: "2026-11-09T06:00:00.000Z" };
  const item = (prefix: string, i: number) => ({ id: `${prefix}${i}`, text: "x".repeat(120) });

  it("takes out memories, notes and tasks in that order only as far as needed, keeping projects in the first part", () => {
    const memories = Array.from({ length: 20 }, (_, i) => item("m", i));
    const notes = Array.from({ length: 20 }, (_, i) => item("n", i));
    const tasks = Array.from({ length: 3 }, (_, i) => item("t", i));
    const backup = { ...head, data: { projects: [{ id: "p1" }], tasks, notes, memories, conversations: [] } };
    const parts = backupImportParts(backup, 2_000);
    // Memories and notes leave; the few tasks stay with their project.
    expect(parts[0]?.data).toEqual({ projects: [{ id: "p1" }], tasks, notes: [], memories: [], conversations: [] });
    expect(parts.slice(1).flatMap((part) => (part.data.memories as unknown[] | undefined) ?? [])).toEqual(memories);
    expect(parts.slice(1).flatMap((part) => (part.data.notes as unknown[] | undefined) ?? [])).toEqual(notes);
    for (const part of parts) expect(new TextEncoder().encode(JSON.stringify(part)).length).toBeLessThanOrEqual(2_000);
  });
});

describe("isBackupEnvelope", () => {
  it("takes the manual backup's envelope and nothing else", () => {
    const ok = { format: "zuri-backup", version: 1, schema: 1, exportedAt: "2026-11-09T06:00:00.000Z", data: {} };
    expect(isBackupEnvelope(ok)).toBe(true);
    for (const bad of [null, "x", [], { ...ok, format: "other" }, { ...ok, version: 2 }, { ...ok, exportedAt: 1 }, { ...ok, data: [] }, { ...ok, data: null }, { ...ok, schema: "1" }]) {
      expect(isBackupEnvelope(bad)).toBe(false);
    }
  });
});
