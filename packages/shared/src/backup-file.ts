import { BACKUP_FORMAT, BACKUP_IMPORT_MAX_BYTES, BACKUP_VERSION } from "./backup.ts";
import { fromBase64Url, toBase64Url } from "./crypto.ts";

/**
 * The automatic backup's file (step 23b, `.zuri`): the JSON of the manual
 * backup, compressed with gzip and sealed with the owner's public key. Only
 * standard Web Crypto is used, so the same code opens it in the browser, in
 * Node 18+ or in Deno, with nothing from Cloudflare.
 *
 * Layout:
 *   "ZURI-BACKUP 1\n"
 *   {"key":"<key id>","epk":"<ephemeral P-256 public key>","salt":"<16 bytes>"}\n
 *   then frames: 4-byte big-endian length + AES-256-GCM ciphertext (tag included)
 *
 * The file key is HKDF-SHA256 over the ECDH secret between a fresh ephemeral
 * key and the owner's key, with the salt and BACKUP_FILE_INFO. Each frame
 * seals at most BACKUP_FILE_CHUNK bytes of the gzip stream; its nonce is its
 * number, and its additional data is the header plus a byte that marks the
 * last frame, so a reordered, cut or extended file never opens.
 */

export const BACKUP_FILE_MAGIC = "ZURI-BACKUP 1\n";
export const BACKUP_FILE_INFO = "zuri-backup-v1";
/** Plain bytes per frame: 1 MiB, so the browser opens a big file a piece at a time. */
export const BACKUP_FILE_CHUNK = 1024 * 1024;
export const BACKUP_FILE_EXTENSION = ".zuri";
/** The name of the key file the browser saves once. */
export const BACKUP_KEY_FILE_NAME = "zuri-chave-do-backup.json";
export const BACKUP_KEY_FORMAT = "zuri-backup-key";

const TAG_BYTES = 16;
const HEADER_MAX = 512;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });

/** A P-256 private key in JWK, as the browser exports it. */
export interface BackupJwk {
  kty: string;
  crv: string;
  x: string;
  y: string;
  d: string;
  ext?: boolean;
  key_ops?: string[];
}

/**
 * The few Web Crypto calls used here, typed once: the Worker's types and the
 * browser's disagree on some names (workerd calls ECDH's `public` `$public`),
 * while the runtime is the same standard API everywhere.
 */
type Key = object;
interface Subtle {
  digest(algorithm: string, data: Uint8Array): Promise<ArrayBuffer>;
  importKey(format: "raw" | "jwk", data: Uint8Array | BackupJwk | ArrayBuffer, algorithm: object | string, extractable: boolean, usages: string[]): Promise<Key>;
  exportKey(format: "raw", key: Key): Promise<ArrayBuffer>;
  exportKey(format: "jwk", key: Key): Promise<BackupJwk>;
  generateKey(algorithm: object, extractable: boolean, usages: string[]): Promise<{ publicKey: Key; privateKey: Key }>;
  deriveBits(algorithm: { name: "ECDH"; public: Key }, key: Key, length: number): Promise<ArrayBuffer>;
  deriveKey(algorithm: object, key: Key, derived: object, extractable: boolean, usages: string[]): Promise<Key>;
  encrypt(algorithm: object, key: Key, data: Uint8Array): Promise<ArrayBuffer>;
  decrypt(algorithm: object, key: Key, data: Uint8Array): Promise<ArrayBuffer>;
}
const subtle = (): Subtle => crypto.subtle as unknown as Subtle;

/** The key file's content: the private key never leaves the owner's hands. */
export interface BackupKeyFile {
  format: typeof BACKUP_KEY_FORMAT;
  version: 1;
  /** The key's short id, also in each backup's header. */
  key: string;
  createdAt: string;
  privateKey: BackupJwk;
}

/** Why a file did not open; the screen says each one in its own words. */
export class BackupFileError extends Error {
  readonly reason: "format" | "key" | "damaged";
  constructor(reason: "format" | "key" | "damaged") {
    super(`backup file: ${reason}`);
    this.reason = reason;
  }
}

const bytes = (value: Uint8Array) => value as Uint8Array<ArrayBuffer>;

/** The short id of a public key: the first 12 bytes of its SHA-256, base64url (16 characters). */
export async function backupKeyId(rawPublicKey: Uint8Array): Promise<string> {
  const digest = new Uint8Array(await subtle().digest("SHA-256", bytes(rawPublicKey)));
  return toBase64Url(digest.slice(0, 12));
}

/** A P-256 public key in its raw form (65 bytes, uncompressed), or null when it isn't one. */
export async function importBackupPublicKey(raw: string): Promise<Key | null> {
  try {
    const decoded = fromBase64Url(raw);
    if (decoded.length !== 65 || decoded[0] !== 4) return null;
    return await subtle().importKey("raw", bytes(decoded), { name: "ECDH", namedCurve: "P-256" }, true, []);
  } catch {
    return null;
  }
}

/**
 * A new key pair, made where it is kept (the browser): the public key goes to
 * the server, the key file only to the owner's download.
 */
export async function createBackupKey(now: Date = new Date()): Promise<{ publicKey: string; file: BackupKeyFile }> {
  const pair = (await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const raw = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
  const privateKey = await subtle().exportKey("jwk", pair.privateKey);
  const key = await backupKeyId(raw);
  return { publicKey: toBase64Url(raw), file: { format: BACKUP_KEY_FORMAT, version: 1, key, createdAt: now.toISOString(), privateKey } };
}

/** Reads a key file, or throws BackupFileError("key"). */
export function parseBackupKeyFile(text: string): BackupKeyFile {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new BackupFileError("key");
  }
  const file = value as Partial<BackupKeyFile> | null;
  const jwk = file?.privateKey as Partial<BackupJwk> | undefined;
  if (
    !file ||
    file.format !== BACKUP_KEY_FORMAT ||
    file.version !== 1 ||
    typeof file.key !== "string" ||
    !jwk ||
    jwk.kty !== "EC" ||
    jwk.crv !== "P-256" ||
    typeof jwk.d !== "string" ||
    typeof jwk.x !== "string" ||
    typeof jwk.y !== "string"
  ) {
    throw new BackupFileError("key");
  }
  return file as BackupKeyFile;
}

async function fileKey(secret: ArrayBuffer, salt: Uint8Array): Promise<Key> {
  const base = await subtle().importKey("raw", secret, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: bytes(salt), info: encoder.encode(BACKUP_FILE_INFO) },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function nonce(counter: number): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12);
  const view = new DataView(out.buffer);
  view.setUint32(4, Math.floor(counter / 2 ** 32));
  view.setUint32(8, counter >>> 0);
  return out;
}

function aad(header: Uint8Array, last: boolean): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(header.length + 1);
  out.set(header);
  out[header.length] = last ? 1 : 0;
  return out;
}

function concat(parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/**
 * Seals a stream of bytes (the gzip of the JSON) for the owner's public key,
 * frame by frame: memory holds one frame, whatever the size of the backup.
 */
export async function* sealBackup(source: AsyncIterable<Uint8Array>, publicKey: string): AsyncGenerator<Uint8Array> {
  const owner = await importBackupPublicKey(publicKey);
  if (!owner) throw new BackupFileError("key");
  const ownerRaw = new Uint8Array(await subtle().exportKey("raw", owner));
  const ephemeral = (await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]));
  const epk = new Uint8Array(await subtle().exportKey("raw", ephemeral.publicKey));
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const secret = await subtle().deriveBits({ name: "ECDH", public: owner }, ephemeral.privateKey, 256);
  const key = await fileKey(secret, salt);
  const header = encoder.encode(`${BACKUP_FILE_MAGIC}${JSON.stringify({ key: await backupKeyId(ownerRaw), epk: toBase64Url(epk), salt: toBase64Url(salt) })}\n`);
  yield header;

  let counter = 0;
  const seal = async (plain: Uint8Array, last: boolean): Promise<Uint8Array> => {
    const sealed = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv: nonce(counter), additionalData: aad(header, last) }, key, bytes(plain)));
    counter += 1;
    const frame = new Uint8Array(4 + sealed.length);
    new DataView(frame.buffer).setUint32(0, sealed.length);
    frame.set(sealed, 4);
    return frame;
  };

  // One full frame is held back until the next byte arrives: only then is it known not to be the last.
  let pending: Uint8Array | null = null;
  let buffer = new Uint8Array(BACKUP_FILE_CHUNK);
  let filled = 0;
  for await (const piece of source) {
    let offset = 0;
    while (offset < piece.length) {
      if (filled === BACKUP_FILE_CHUNK) {
        if (pending) yield await seal(pending, false);
        pending = buffer;
        buffer = new Uint8Array(BACKUP_FILE_CHUNK);
        filled = 0;
      }
      const take = Math.min(BACKUP_FILE_CHUNK - filled, piece.length - offset);
      buffer.set(piece.subarray(offset, offset + take), filled);
      filled += take;
      offset += take;
    }
  }
  if (filled > 0 || !pending) {
    if (pending) yield await seal(pending, false);
    yield await seal(buffer.subarray(0, filled), true);
  } else {
    yield await seal(pending, true);
  }
}

/** The key id a file was sealed for, read from its header, or null when it isn't a backup file. */
export function backupFileKey(file: Uint8Array): string | null {
  try {
    return readHeader(file).fields.key;
  } catch {
    return null;
  }
}

function readHeader(file: Uint8Array): { header: Uint8Array; fields: { key: string; epk: string; salt: string } } {
  const magic = encoder.encode(BACKUP_FILE_MAGIC);
  if (file.length < magic.length || magic.some((byte, i) => file[i] !== byte)) throw new BackupFileError("format");
  const end = file.subarray(magic.length, magic.length + HEADER_MAX).indexOf(10);
  if (end < 0) throw new BackupFileError("format");
  const header = file.subarray(0, magic.length + end + 1);
  let fields: { key?: unknown; epk?: unknown; salt?: unknown };
  try {
    fields = JSON.parse(decoder.decode(file.subarray(magic.length, magic.length + end))) as typeof fields;
  } catch {
    throw new BackupFileError("format");
  }
  if (typeof fields?.key !== "string" || typeof fields.epk !== "string" || typeof fields.salt !== "string") throw new BackupFileError("format");
  return { header, fields: { key: fields.key, epk: fields.epk, salt: fields.salt } };
}

/**
 * Opens a sealed file with the owner's key file: the gzip bytes, checked frame
 * by frame. A wrong key says "key"; a changed, cut or extended file "damaged".
 */
export async function openBackup(file: Uint8Array, keyFile: BackupKeyFile): Promise<Uint8Array> {
  const { header, fields } = readHeader(file);
  if (fields.key !== keyFile.key) throw new BackupFileError("key");
  let owner: Key;
  let epk: Key;
  let salt: Uint8Array;
  try {
    owner = await subtle().importKey("jwk", keyFile.privateKey, { name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
  } catch {
    throw new BackupFileError("key");
  }
  try {
    const imported = await importBackupPublicKey(fields.epk);
    if (!imported) throw new Error("epk");
    epk = imported;
    salt = fromBase64Url(fields.salt);
  } catch {
    throw new BackupFileError("format");
  }
  const key = await fileKey(await subtle().deriveBits({ name: "ECDH", public: epk }, owner, 256), salt);

  const out: Uint8Array[] = [];
  let at = header.length;
  let counter = 0;
  while (at < file.length) {
    if (at + 4 > file.length) throw new BackupFileError("damaged");
    const length = new DataView(file.buffer, file.byteOffset + at, 4).getUint32(0);
    if (length < TAG_BYTES || length > BACKUP_FILE_CHUNK + TAG_BYTES || at + 4 + length > file.length) throw new BackupFileError("damaged");
    const sealed = file.subarray(at + 4, at + 4 + length);
    at += 4 + length;
    const last = at === file.length;
    try {
      out.push(new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: nonce(counter), additionalData: aad(header, last) }, key, bytes(sealed))));
    } catch {
      throw new BackupFileError("damaged");
    }
    counter += 1;
  }
  if (counter === 0) throw new BackupFileError("damaged");
  return concat(out);
}

type Opened = { format: string; version: number; schema: number; exportedAt: string; data: Record<string, unknown> };
export type BackupParts = Opened[];

/** The bytes an opened copy may reach once decompressed: 20 imports' worth, so a forged file can't fill the tab's memory. */
export const BACKUP_RESTORE_MAX_BYTES = 20 * BACKUP_IMPORT_MAX_BYTES;

/** What a copy holds before the server judges it: the envelope of the manual backup, nothing more. */
export function isBackupEnvelope(value: unknown): value is Opened {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return v.format === BACKUP_FORMAT && v.version === BACKUP_VERSION && typeof v.schema === "number" && typeof v.exportedAt === "string" && Boolean(v.data) && typeof v.data === "object" && !Array.isArray(v.data);
}

/**
 * The lists taken out of the first part, in this order, until it fits: the
 * record of the day (it only grows, and each day stands alone), the
 * conversations, then memories, notes and tasks. Projects, settings,
 * automations and the CRM always stay in the first part; a task or note sent
 * in a later part arrives without its project, since links only hold within
 * one import.
 */
const SPLIT_ORDER = ["agendaRecord", "conversations", "memories", "notes", "tasks"] as const;

/**
 * An opened backup as imports of at most `max` bytes each (the import's 10
 * MB): the first part with what fits, then the lists taken out in batches.
 * Each part is all or nothing on the server; one that alone passes the limit
 * is left as it is, and the server refuses it.
 */
export function backupImportParts(backup: Opened, max: number = BACKUP_IMPORT_MAX_BYTES): BackupParts {
  const size = (value: unknown) => encoder.encode(JSON.stringify(value)).length;
  if (size(backup) <= max) return [backup];
  const head = { format: backup.format, version: backup.version, schema: backup.schema, exportedAt: backup.exportedAt };
  const first: Record<string, unknown> = { ...backup.data };
  const taken: (typeof SPLIT_ORDER)[number][] = [];
  for (const name of SPLIT_ORDER) {
    if (size({ ...head, data: first }) <= max) break;
    if (!Array.isArray(first[name]) || (first[name] as unknown[]).length === 0) continue;
    first[name] = [];
    taken.push(name);
  }
  const out: BackupParts = [{ ...head, data: first }];
  for (const name of taken) {
    const items = backup.data[name] as unknown[];
    // Room for the envelope around each batch.
    const room = max - size({ ...head, data: { [name]: [] } }) - 16;
    let batch: unknown[] = [];
    let used = 0;
    for (const item of items) {
      const bytes = size(item) + 1;
      if (batch.length > 0 && used + bytes > room) {
        out.push({ ...head, data: { [name]: batch } });
        batch = [];
        used = 0;
      }
      batch.push(item);
      used += bytes;
    }
    if (batch.length > 0) out.push({ ...head, data: { [name]: batch } });
  }
  return out;
}
