import { CHATWOOT_LIMITS, chatwootGapsProblem, type FlowDefinition, type FlowNode } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { McpCredentials } from "../src/mcp/credentials.ts";
import { addConnection, type FlowWorld, withFlowWorld } from "./flow-world.ts";
import { testEnv } from "./helpers.ts";

// PR S17: credential kinds (http and chatwoot), the Chatwoot's waits and inbox, the test, and the key's end.

const HOST = "chat.exemplo.com.br";
const KEY = "chave-do-agente-zuri-4f2a";
const manual = (nodes: FlowNode[]): FlowDefinition => ({ version: 1, trigger: { type: "manual" }, nodes });
const get = (connection: string, path: string): FlowNode => ({ type: "request", connection, method: "GET", path, body: "none", each: false, itemsPath: "" });

const addChatwoot = (world: FlowWorld, patch: Record<string, unknown> = {}) =>
  world.connections.create({ kind: "chatwoot", name: "Chatwoot do consultório", origin: `https://${HOST}`, accountId: 1, credential: KEY, ...patch }, { development: false });

const inboxes = (list: unknown[]) => () => Response.json({ payload: list });
const opts = (world: FlowWorld) => ({ development: false, inboxes: world.flows.inboxLookup });
const sealed = (world: FlowWorld, id: string) => world.db.one<{ credential: string | null }>(`SELECT credential FROM zur_flow_connections WHERE id = ?`, id)?.credential ?? null;

describe("credential kinds", () => {
  it("a Chatwoot credential keeps its account, the default waits and the key's end, sealed under its own key", async () => {
    await withFlowWorld(async (world) => {
      const id = await addChatwoot(world);
      const [item] = world.flows.list().connections;
      expect(item).toMatchObject({
        id,
        kind: "chatwoot",
        origin: `https://${HOST}`,
        methods: [],
        paths: [],
        hasCredential: true,
        keyEnd: "4f2a",
        chatwoot: { accountId: 1, inboxId: null, inboxName: null, bulkGap: { min: 30, max: 60 }, oneGap: { min: 2, max: 5 } },
      });
      // The row keeps only the settings: no limit of the code is copied into it.
      expect(JSON.parse(world.connections.row(id).meta as string)).toEqual({ accountId: 1, inboxId: null, inboxName: null, bulkGap: { min: 30, max: 60 }, oneGap: { min: 2, max: 5 } });
      expect(world.connections.row(id)).toMatchObject({ auth: "header", header_name: "api_access_token", key_end: "4f2a" });
      // The key itself never leaves the server, in any shape.
      expect(JSON.stringify(world.flows.list())).not.toContain(KEY);
      const stored = sealed(world, id) as string;
      expect(stored).not.toContain(KEY);
      expect(await new McpCredentials(testEnv.MCP_CREDENTIAL_KEY, "chatwoot-v1").decrypt(id, stored)).toBe(KEY);
      // Sealed for the Chatwoot, it never opens as a flow's key (nor an MCP server's).
      expect(await new McpCredentials(testEnv.MCP_CREDENTIAL_KEY, "flows-v1").decrypt(id, stored)).toBeNull();
      expect(await new McpCredentials(testEnv.MCP_CREDENTIAL_KEY).decrypt(id, stored)).toBeNull();
    });
  });

  it("an http body of before (no kind) is an http credential; kind 'http' is the same; any other kind is refused by name", async () => {
    await withFlowWorld(async (world) => {
      const a = await addConnection(world);
      const b = await addConnection(world, { kind: "http", name: "Outro" });
      expect(world.flows.list().connections.map((item) => item.kind)).toEqual(["http", "http"]);
      expect(world.connections.row(a).kind).toBe("http");
      expect(world.connections.row(b).kind).toBe("http");
      for (const kind of ["fzap", "", 1, null, "HTTP"]) {
        await expect(addConnection(world, { kind })).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["kind"] } });
      }
      // A Chatwoot body with an http field (methods) is refused too: each kind takes only its own fields.
      await expect(addChatwoot(world, { methods: ["GET"] })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(addChatwoot(world, { credential: undefined })).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["credential"] } });
      await expect(addChatwoot(world, { origin: "http://chat.exemplo.com.br" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(addChatwoot(world, { origin: "https://192.168.0.10" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    });
  });

  it("shows a key's end only from 12 characters (11 and 12)", async () => {
    await withFlowWorld(async (world) => {
      const short = await addConnection(world, { name: "A", credential: "abcdefghijk" });
      const long = await addConnection(world, { name: "B", credential: "abcdefghijkl" });
      const none = await addConnection(world, { name: "C", auth: "none", credential: undefined });
      const byId = new Map(world.flows.list().connections.map((item) => [item.id, item]));
      expect(byId.get(short)).toMatchObject({ hasCredential: true, keyEnd: null });
      expect(byId.get(long)).toMatchObject({ hasCredential: true, keyEnd: "ijkl" });
      expect(byId.get(none)).toMatchObject({ hasCredential: false, keyEnd: null });
    });
  });

  it("takes the account from 1 to 999.999.999", async () => {
    await withFlowWorld(async (world) => {
      for (const accountId of [0, CHATWOOT_LIMITS.accountMax + 1, 1.5, "1"]) {
        await expect(addChatwoot(world, { accountId })).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["accountId"] } });
      }
      await addChatwoot(world, { accountId: 1 });
      await addChatwoot(world, { accountId: CHATWOOT_LIMITS.accountMax, name: "Outro" });
    });
  });

  it("an unknown kind in the database (a newer version's) shows as it is, and is neither called nor changed", async () => {
    await withFlowWorld(async (world) => {
      const id = await addConnection(world);
      const flow = await world.flows.create({ name: "X", definition: manual([get(id, "/v1/a")]) });
      world.db.run(`UPDATE zur_flow_connections SET kind = 'fzap' WHERE id = ?`, id);
      expect(world.flows.list().connections[0]?.kind).toBe("fzap");
      expect((await world.flows.runNow(flow.id)).problem).toBe("kind_not_allowed");
      await expect(world.connections.update(id, { name: "Y" }, { development: false })).rejects.toMatchObject({ code: "CONFLICT" });
      expect(await world.flows.testConnection(id)).toEqual({ ok: false, problem: "kind_not_allowed", status: null });
      expect(world.network.requests).toHaveLength(0);
    });
  });
});

describe("the Chatwoot's waits", () => {
  it("are checked at the limits (n-1, n, n+1) by the shared rule", () => {
    const ok = { min: 30, max: 60 };
    const one = { min: 2, max: 5 };
    expect(chatwootGapsProblem(ok, one)).toBeNull();
    expect(chatwootGapsProblem({ min: 4, max: 60 }, one)).toBe("bulkGap");
    expect(chatwootGapsProblem({ min: 6, max: 600 }, one)).toBeNull();
    expect(chatwootGapsProblem({ min: 30, max: 601 }, one)).toBe("bulkGap");
    expect(chatwootGapsProblem({ min: 61, max: 60 }, one)).toBe("bulkGap");
    expect(chatwootGapsProblem({ min: 60, max: 60 }, one)).toBeNull();
    expect(chatwootGapsProblem(ok, { min: 0, max: 5 })).toBe("oneGap");
    expect(chatwootGapsProblem(ok, { min: 1, max: 1 })).toBeNull();
    expect(chatwootGapsProblem({ min: 40, max: 60 }, { min: 1, max: 31 })).toBe("oneGap");
    expect(chatwootGapsProblem({ min: 31, max: 60 }, { min: 1, max: 30 })).toBeNull();
    // One person's "to" stays below the bulk "from": 29 < 30 passes, 30 doesn't.
    expect(chatwootGapsProblem({ min: 30, max: 60 }, { min: 1, max: 29 })).toBeNull();
    expect(chatwootGapsProblem({ min: 30, max: 60 }, { min: 1, max: 30 })).toBe("oneGap");
    expect(chatwootGapsProblem({ min: 5, max: 600 }, { min: 6, max: 5 })).toBe("oneGap");
    expect(chatwootGapsProblem({ min: 5.5, max: 60 }, one)).toBe("bulkGap");
  });

  it("are refused out of range when the credential is made or changed, and a change of the waits alone keeps the rest", async () => {
    await withFlowWorld(async (world) => {
      await expect(addChatwoot(world, { bulkGap: { min: 4, max: 60 } })).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["bulkGap"] } });
      await expect(addChatwoot(world, { oneGap: { min: 2, max: 30 } })).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["oneGap"] } });
      const id = await addChatwoot(world, { bulkGap: { min: 5, max: 600 }, oneGap: { min: 1, max: 4 } });
      expect(world.flows.list().connections[0]?.chatwoot).toMatchObject({ bulkGap: { min: 5, max: 600 }, oneGap: { min: 1, max: 4 } });
      // Merged with what is kept: a new bulk "from" below one person's "to" is refused.
      await expect(world.connections.update(id, { bulkGap: { min: 4, max: 10 } }, opts(world))).rejects.toMatchObject({ details: { fields: ["bulkGap"] } });
      await expect(world.connections.update(id, { bulkGap: { min: 5, max: 10 }, oneGap: { min: 1, max: 5 } }, opts(world))).rejects.toMatchObject({ details: { fields: ["oneGap"] } });
      const key = sealed(world, id);
      const before = world.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_activity WHERE kind = 'flow.connection_changed'`)?.n ?? 0;
      expect(await world.connections.update(id, { bulkGap: { min: 45, max: 90 } }, opts(world))).toEqual({ sensitive: false });
      expect(world.flows.list().connections[0]).toMatchObject({ hasCredential: true, keyEnd: "4f2a", chatwoot: { bulkGap: { min: 45, max: 90 }, oneGap: { min: 1, max: 4 } } });
      expect(sealed(world, id)).toBe(key);
      // Not sensitive, but in the activity log.
      expect(world.db.one<{ n: number }>(`SELECT count(*) AS n FROM zur_activity WHERE kind = 'flow.connection_changed'`)?.n).toBe(before + 1);
    });
  });

  it("a row edited by hand out of range reads as the defaults, never breaking the list", async () => {
    await withFlowWorld(async (world) => {
      const id = await addChatwoot(world);
      for (const meta of ["{", "[]", '{"bulkGap":{"min":1,"max":2},"oneGap":{"min":1,"max":1}}', '{"accountId":-3,"inboxId":"x"}']) {
        world.db.run(`UPDATE zur_flow_connections SET meta = ? WHERE id = ?`, meta, id);
        expect(world.flows.list().connections[0]?.chatwoot).toEqual({ accountId: 1, inboxId: null, inboxName: null, bulkGap: { min: 30, max: 60 }, oneGap: { min: 2, max: 5 } });
      }
    });
  });
});

describe("the Chatwoot's address, account and key", () => {
  it("a new address or account needs the key again, and drops the picked inbox", async () => {
    await withFlowWorld(async (world) => {
      world.network.handlers.set(HOST, inboxes([{ id: 7, name: "WhatsApp do consultório", channel_type: "Channel::Api" }]));
      world.network.handlers.set("novo.exemplo.com.br", inboxes([]));
      const id = await addChatwoot(world);
      await world.connections.update(id, { inboxId: 7 }, opts(world));
      for (const patch of [{ origin: "https://novo.exemplo.com.br" }, { accountId: 2 }]) {
        await expect(world.connections.update(id, patch, opts(world))).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["credential"] } });
        expect(world.flows.list().connections[0]).toMatchObject({ origin: `https://${HOST}`, chatwoot: { accountId: 1, inboxId: 7 } });
      }
      // The same address again isn't a move.
      await world.connections.update(id, { origin: `https://${HOST}`, accountId: 1, name: "Renomeado" }, opts(world));
      expect(world.flows.list().connections[0]?.chatwoot?.inboxId).toBe(7);
      expect(await world.connections.update(id, { accountId: 2, credential: "chave-da-conta-dois-77aa" }, opts(world))).toEqual({ sensitive: true });
      expect(world.flows.list().connections[0]).toMatchObject({ keyEnd: "77aa", chatwoot: { accountId: 2, inboxId: null, inboxName: null } });
      expect(await new McpCredentials(testEnv.MCP_CREDENTIAL_KEY, "chatwoot-v1").decrypt(id, sealed(world, id) as string)).toBe("chave-da-conta-dois-77aa");
    });
  });

  it("an inbox is picked only when the saved key sees it, and its name is kept (cut, without control characters)", async () => {
    await withFlowWorld(async (world) => {
      const long = `Caixa\u0007\u202e ${"x".repeat(200)}`;
      world.network.handlers.set(
        HOST,
        inboxes([
          { id: 7, name: "WhatsApp do consultório", channel_type: "Channel::Api" },
          { id: 8, name: long, channel_type: "Channel::Email", extra: { ignored: true } },
        ]),
      );
      const id = await addChatwoot(world);
      await expect(world.connections.update(id, { inboxId: 9 }, opts(world))).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["inboxId"] } });
      expect(world.flows.list().connections[0]?.chatwoot?.inboxId).toBeNull();
      expect(await world.connections.update(id, { inboxId: 8 }, opts(world))).toEqual({ sensitive: true });
      const name = world.flows.list().connections[0]?.chatwoot?.inboxName as string;
      expect([...name]).toHaveLength(CHATWOOT_LIMITS.inboxName);
      expect([...name].some((ch) => ch === "\u0007" || ch === "\u202e")).toBe(false);
      await world.connections.update(id, { inboxId: 7 }, opts(world));
      expect(world.flows.list().connections[0]?.chatwoot).toMatchObject({ inboxId: 7, inboxName: "WhatsApp do consultório" });
      // The key goes in the Chatwoot's own header, to the fixed path of the account; nothing else is sent.
      const request = world.network.requests.at(-1) as Request;
      expect(request.method).toBe("GET");
      expect(new URL(request.url).pathname).toBe("/api/v1/accounts/1/inboxes");
      expect(request.headers.get("api_access_token")).toBe(KEY);
      expect(request.headers.get("authorization")).toBeNull();
      await world.connections.update(id, { inboxId: null }, opts(world));
      expect(world.flows.list().connections[0]?.chatwoot).toMatchObject({ inboxId: null, inboxName: null });
    });
  });

  it("a pick that can't be checked (the Chatwoot down) is refused and keeps the inbox of before", async () => {
    await withFlowWorld(async (world) => {
      world.network.handlers.set(HOST, inboxes([{ id: 7, name: "WhatsApp", channel_type: "Channel::Api" }]));
      const id = await addChatwoot(world);
      await world.connections.update(id, { inboxId: 7 }, opts(world));
      world.network.handlers.set(HOST, () => new Response("down", { status: 503 }));
      await expect(world.connections.update(id, { inboxId: 7 }, opts(world))).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fields: ["inboxId"], problem: "http_error" } });
      expect(world.flows.list().connections[0]?.chatwoot?.inboxId).toBe(7);
    });
  });
});

describe("Testar", () => {
  it("lists the Chatwoot's inboxes (50 at most), reading only", async () => {
    await withFlowWorld(async (world) => {
      const many = Array.from({ length: 60 }, (_, i) => ({ id: i + 1, name: `Caixa ${i + 1}`, channel_type: i === 0 ? "Channel::Api" : "Channel::Email" }));
      world.network.handlers.set(HOST, inboxes(many));
      const id = await addChatwoot(world);
      const test = await world.flows.testConnection(id);
      expect(test).toMatchObject({ ok: true, status: null });
      if (!test.ok) throw new Error("expected ok");
      expect(test.inboxes).toHaveLength(CHATWOOT_LIMITS.inboxes);
      expect(test.inboxes?.[0]).toEqual({ id: 1, name: "Caixa 1", api: true });
      expect(test.inboxes?.[1]?.api).toBe(false);
      expect(world.network.requests.map((request) => request.method)).toEqual(["GET"]);
      // Nothing changed: the test doesn't pick an inbox.
      expect(world.flows.list().connections[0]?.chatwoot?.inboxId).toBeNull();
    });
  });

  it("says why it didn't pass: refused key, unknown answer, redirect, private address", async () => {
    await withFlowWorld(async (world) => {
      const id = await addChatwoot(world);
      const cases: [() => void, unknown][] = [
        [() => world.network.handlers.set(HOST, () => new Response("no", { status: 401 })), { ok: false, problem: "http_error", status: 401 }],
        [() => world.network.handlers.set(HOST, () => Response.json({ data: [] })), { ok: false, problem: "bad_answer", status: null }],
        [() => world.network.handlers.set(HOST, () => new Response(null, { status: 302, headers: { location: "https://outro.exemplo.com.br" } })), { ok: false, problem: "redirect", status: null }],
        [
          () => {
            world.network.handlers.set(HOST, inboxes([]));
            world.network.addresses.set(HOST, ["10.0.0.5"]);
          },
          { ok: false, problem: "private_address", status: null },
        ],
      ];
      for (const [arrange, expected] of cases) {
        arrange();
        expect(await world.flows.testConnection(id)).toEqual(expected);
      }
    });
  });

  it("a key that doesn't open is told, and nothing goes out", async () => {
    await withFlowWorld(async (world) => {
      world.network.handlers.set(HOST, inboxes([]));
      const id = await addChatwoot(world);
      // A key sealed for flows on the same row: right id, wrong kind.
      const wrong = await new McpCredentials(testEnv.MCP_CREDENTIAL_KEY, "flows-v1").encrypt(id, KEY);
      world.db.run(`UPDATE zur_flow_connections SET credential = ? WHERE id = ?`, wrong, id);
      expect(await world.flows.testConnection(id)).toEqual({ ok: false, problem: "credential", status: null });
      expect(world.network.requests).toHaveLength(0);
    });
  });

  it("an http credential gets one GET of its first path, only when GET is allowed", async () => {
    await withFlowWorld(async (world) => {
      world.network.handlers.set("api.exemplo.com.br", () => Response.json({ ok: true }));
      const id = await addConnection(world, { paths: ["/v1/status", "/v1"] });
      world.clock.now += 120;
      const test = await world.flows.testConnection(id);
      expect(test).toEqual({ ok: true, ms: 0, status: 200, inboxes: null });
      expect(new URL((world.network.requests[0] as Request).url).pathname).toBe("/v1/status");
      const postOnly = await addConnection(world, { name: "Só envia", methods: ["POST"] });
      expect(await world.flows.testConnection(postOnly)).toEqual({ ok: false, problem: "method_not_allowed", status: null });
      expect(world.network.requests).toHaveLength(1);
    });
  });

  it("runs at most 5 times a minute per credential (the 6th waits until the first is a minute old)", async () => {
    await withFlowWorld(async (world) => {
      world.network.handlers.set(HOST, inboxes([]));
      const a = await addChatwoot(world);
      const b = await addChatwoot(world, { name: "Outra" });
      for (let i = 0; i < 5; i++) {
        expect((await world.flows.testConnection(a)).ok).toBe(true);
        world.clock.now += 1_000;
      }
      await expect(world.flows.testConnection(a)).rejects.toMatchObject({ code: "RATE_LIMITED", details: { retryAfter: 55 } });
      // Another credential has its own count.
      expect((await world.flows.testConnection(b)).ok).toBe(true);
      world.clock.now += 54_999;
      await expect(world.flows.testConnection(a)).rejects.toMatchObject({ code: "RATE_LIMITED", details: { retryAfter: 1 } });
      world.clock.now += 1;
      expect((await world.flows.testConnection(a)).ok).toBe(true);
      await expect(world.flows.testConnection("00000000-0000-4000-8000-000000000000")).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});

describe("flows and the Chatwoot credential", () => {
  it("a flow can't be saved calling it, and a flow whose credential became one never calls it", async () => {
    await withFlowWorld(async (world) => {
      world.network.handlers.set(HOST, () => Response.json({ payload: [] }));
      const chatwoot = await addChatwoot(world);
      await expect(world.flows.create({ name: "Mensagem", definition: manual([get(chatwoot, "/api/v1/accounts/1/conversations")]) })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        messageKey: "error.flowConnectionKind",
      });
      // A row turned into a Chatwoot one under a saved flow (by hand): the engine refuses too.
      const http = await addConnection(world);
      world.network.handlers.set("api.exemplo.com.br", () => Response.json({}));
      const flow = await world.flows.create({ name: "X", definition: manual([get(http, "/v1/a")]) });
      world.db.run(`UPDATE zur_flow_connections SET kind = 'chatwoot' WHERE id = ?`, http);
      expect((await world.flows.runNow(flow.id)).problem).toBe("kind_not_allowed");
      expect(world.network.requests).toHaveLength(0);
    });
  });
});
