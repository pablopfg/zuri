import { BACKUP_IMPORT_MAX_BYTES, DATABASE_MAX_BYTES, STORAGE_LIMITS, STORAGE_USE_KINDS, type StorageUse, CRM_LIMITS } from "@zuri/shared";
import type { Context, Hono } from "hono";
import type { ClientInfo } from "../auth/client.ts";
import type { AuthService } from "../auth/service.ts";
import { exportStream, type ExportDeps } from "../backup/export.ts";
import { importBackup, type ImportDeps, parseBackup } from "../backup/import.ts";
import { AppError } from "../http/errors.ts";
import type { StorageGuard } from "../productivity/storage.ts";
import type { ApiEnv } from "./app.ts";
import { readBodyLimited } from "./http.ts";

export interface BackupRouteDeps {
  auth: AuthService;
  storage: StorageGuard;
  exporter: ExportDeps;
  importer: ImportDeps;
  /** After an import: the alarm again (a new zone moves the schedules) and the CRM's birthday notice. */
  afterImport(): Promise<void>;
}

/**
 * Settings › Data (step 23): storage use, the export and the import. Export
 * and import are sensitive (spec rule 7): the password typed in the last 15
 * minutes, and an alert on every channel. Not in WHILE_LOCKDOWN nor in the
 * remote tokens' list: a lockdown answers 423 and a token 403.
 */
export function registerBackupRoutes(app: Hono<ApiEnv>, deps: () => BackupRouteDeps, client: (c: Context<ApiEnv>) => ClientInfo): void {
  app.get("/storage", () => {
    const { storage } = deps();
    const limits: Record<string, number> = { ...STORAGE_LIMITS, crm_clients: CRM_LIMITS.clients };
    const body: StorageUse = {
      kinds: STORAGE_USE_KINDS.map((kind) => ({ kind, count: Math.max(0, storage.count(kind)), limit: limits[kind] ?? 0 })),
      bytes: storage.bytes(),
      maxBytes: DATABASE_MAX_BYTES,
    };
    return Response.json(body);
  });

  app.get("/backup/export", (c) => {
    const { auth, exporter } = deps();
    auth.requireRecentAuth(c.get("session"));
    auth.events.record("backup_exported", client(c), { session: c.get("session").id.slice(0, 16), alert: true });
    const day = new Date().toISOString().slice(0, 10);
    return new Response(exportStream(exporter), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="zuri-backup-${day}.json"`,
        "cache-control": "no-store",
      },
    });
  });

  app.post("/backup/import", async (c) => {
    const { auth, importer, afterImport } = deps();
    auth.requireRecentAuth(c.get("session"));
    if (!c.req.header("content-type")?.toLowerCase().startsWith("application/json")) {
      await c.req.raw.body?.cancel();
      throw new AppError("VALIDATION_FAILED", undefined, { fields: ["_body"] });
    }
    const raw = await readBodyLimited(c.req.raw, BACKUP_IMPORT_MAX_BYTES);
    let parsed: unknown;
    try {
      parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(raw));
    } catch {
      throw new AppError("VALIDATION_FAILED", "error.backup.invalid", { fields: ["_body"] });
    }
    const summary = importBackup(importer, parseBackup(parsed));
    auth.events.record("backup_imported", client(c), { session: c.get("session").id.slice(0, 16), alert: true });
    await afterImport();
    return Response.json({ summary });
  });
}
