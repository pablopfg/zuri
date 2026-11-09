import type { BackupBucket } from "./automatic.ts";

interface Stored {
  bytes: Uint8Array;
  uploaded: Date;
}

/**
 * The backup's bucket of local development (a loopback http PUBLIC_URL, as
 * for the mock AI, the bot and the push services): copies live in the
 * process's memory, so `npm run dev` and the e2e tests show the automatic
 * backup without a Cloudflare account. A deploy only ever uses BACKUP_BUCKET.
 * The tests use it too, counting each call as R2 would bill it.
 */
export class MemoryBucket implements BackupBucket {
  readonly objects = new Map<string, Stored>();
  /** Calls made, by R2's operation name. */
  readonly calls: Record<string, number> = {};
  /** Tests make a call fail here, by name. */
  failOn: Set<string> = new Set();
  #uploads = 0;
  #clock: () => Date;
  readonly #minPart: number;

  constructor(clock: () => Date = () => new Date(), minPart = 5 * 1024 * 1024) {
    this.#clock = clock;
    this.#minPart = minPart;
  }

  #count(name: string): void {
    this.calls[name] = (this.calls[name] ?? 0) + 1;
    if (this.failOn.has(name)) throw new Error(`${name} failed`);
  }

  #object(key: string, stored: Stored): R2ObjectBody {
    const bytes = stored.bytes;
    return {
      key,
      size: bytes.length,
      uploaded: stored.uploaded,
      get body() {
        return new Response(bytes).body as ReadableStream;
      },
      arrayBuffer: async () => bytes.slice().buffer,
    } as unknown as R2ObjectBody;
  }

  async put(key: string, value: unknown): Promise<R2Object> {
    this.#count("PutObject");
    const bytes = new Uint8Array(await new Response(value as BodyInit).arrayBuffer());
    const stored = { bytes, uploaded: this.#clock() };
    this.objects.set(key, stored);
    return this.#object(key, stored);
  }

  async get(key: string): Promise<R2ObjectBody | null> {
    this.#count("GetObject");
    const stored = this.objects.get(key);
    return stored ? this.#object(key, stored) : null;
  }

  async list(options?: R2ListOptions): Promise<R2Objects> {
    this.#count("ListObjects");
    const objects = [...this.objects.entries()].filter(([key]) => key.startsWith(options?.prefix ?? "")).map(([key, stored]) => this.#object(key, stored));
    return { objects, truncated: false, delimitedPrefixes: [] } as unknown as R2Objects;
  }

  async delete(keys: string | string[]): Promise<void> {
    this.#count("DeleteObject");
    for (const key of Array.isArray(keys) ? keys : [keys]) this.objects.delete(key);
  }

  async createMultipartUpload(key: string): Promise<R2MultipartUpload> {
    this.#count("CreateMultipartUpload");
    const uploadId = `upload-${++this.#uploads}`;
    const parts = new Map<number, Uint8Array>();
    const bucket = this;
    return {
      key,
      uploadId,
      async uploadPart(partNumber: number, value: unknown): Promise<R2UploadedPart> {
        bucket.#count("UploadPart");
        parts.set(partNumber, new Uint8Array(await new Response(value as BodyInit).arrayBuffer()));
        return { partNumber, etag: `etag-${partNumber}` };
      },
      async abort(): Promise<void> {
        bucket.#count("AbortMultipartUpload");
        parts.clear();
      },
      async complete(uploaded: R2UploadedPart[]): Promise<R2Object> {
        bucket.#count("CompleteMultipartUpload");
        const chunks = uploaded.map((part) => parts.get(part.partNumber) ?? new Uint8Array());
        // R2's rule: every part but the last of one size, at least 5 MiB.
        const first = chunks[0]?.length ?? 0;
        if (chunks.slice(0, -1).some((chunk) => chunk.length !== first || chunk.length < bucket.#minPart)) throw new Error("parts of different sizes");
        const bytes = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
        let at = 0;
        for (const chunk of chunks) {
          bytes.set(chunk, at);
          at += chunk.length;
        }
        const stored = { bytes, uploaded: bucket.#clock() };
        bucket.objects.set(key, stored);
        return bucket.#object(key, stored);
      },
    } as unknown as R2MultipartUpload;
  }
}

/** The one bucket of local development, for the life of the process. */
export const developmentBucket = new MemoryBucket();
