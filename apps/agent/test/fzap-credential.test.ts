import { FLOW_LIMITS, type FlowDefinition, type FlowNode } from "@zuri/shared";
import { describe, expect, it } from "vitest";
import { McpCredentials } from "../src/mcp/credentials.ts";
import { addConnection, type FlowWorld, withFlowWorld } from "./flow-world.ts";
import { testEnv } from "./helpers.ts";

// E6b (docs/planos/credencial-fzap.md): the fzap's credential in the vault, its test and its edits.

const HOST = "fzap.exemplo.com.br";
const TOKEN = "token-da-instancia-fzap-9b3c";
const manual = (nodes: FlowNode[]): FlowDefinition => ({ version: 1, trigger: { type: "manual" }, nodes });
const get = (connection: string, path: string): FlowNode => ({ type: "request", connection, method: "GET", path, body: "none", each: false, itemsPath: "" });

const addFzap = (world: FlowWorld, patch: Record<string, unknown> = {}) =>
  world.connections.create({ kind: "fzap", name: "fzap do consultório", origin: `https://${HOST}`, credential: TOKEN, ...patch }, { development: false });
const opts = { development: false };
const sealed = (world: FlowWorld, id: string) => world.db.one<{ credential: string | null }>(`SELECT credential FROM zur_flow_connections WHERE id = ?`, id)?.credential ?? null;
const status = (data: Record<string, unknown>) => () => Response.json({ code: 200, success: true, data });
const activity = (world: FlowWorld) => world.db.all<{ action: string; detail: string }>(`SELECT kind AS action, detail FROM zur_activity WHERE kind LIKE 'flow.connection%' ORDER BY rowid`);

describe("the fzap credential", () => {
  it("keeps the address, the token's end and the token header, sealed under its own key", async () => {
    await withFlowWorld(async (world) => {
      const id = await addFzap(world);
      const [item] = world.flows.list().connections;
      expect(item).toMatchObject({ id, kind: "fzap", name: "fzap do consultório", origin: `https://${HOST}`, methods: [], paths: [], hasCredential: true, keyEnd: "9b3c", chatwoot: null });
      expect(world.connections.row(id)).toMatchObject({ auth: "header", header_name: "token", kind: "fzap", key_end: "9b3c" });
      expect(JSON.stringify(world.flows.list())).not.toContain(TOKEN);
      const stored = sealed(world, id) as string;
      expect(stored).not.toContain(TOKEN);
      expect(await new McpCredentials(testEnv.MCP_CREDENTIAL_KEY, "fzap-v1").decrypt(id, stored)).toBe(TOKEN);
      // Sealed for the fzap, it opens as no other kind.
      for (const info of ["flows-v1", "chatwoot-v1", "chatwoot-dono-v1"]) expect(await new McpCredentials(testEnv.MCP_CREDENTIAL_KEY, info).decrypt(id, stored)).toBeNull();
      expect(activity(world).at(-1)).toMatchObject({ action: "flow.connection_added" });
      expect(JSON.parse(activity(world).at(-1)?.detail as string)).toMatchObject({ kind: "fzap" });
    });
  });

  it("refuses a body without a token, with another kind's fields, a path, http or a private address", async () => {
    await withFlowWorld(async (world) => {
      const cases: [Record<string, unknown>, string][] = [
        [{ credential: undefined }, "credential"],
        [{ credential: "" }, "credential"],
        [{ origin: "http://fzap.exemplo.com.br" }, "origin"],
        [{ origin: "https://fzap.exemplo.com.br/session" }, "origin"],
        [{ origin: "https://usuario@fzap.exemplo.com.br" }, "origin"],
        [{ origin: "https://192.168.0.10" }, "origin"],
        [{ name: "" }, "name"],
      ];
      for (const [patch, field] of cases) {
        await expect(addFzap(world, patch)).rejects.toMatchObject({ code: "VALIDATION_FAILED", details: { fields: [field] } });
      }
      for (const extra of [{ accountId: 1 }, { methods: ["GET"] }, { headerName: "authorization" }, { auth: "bearer" }]) {
        await expect(addFzap(world, extra)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      }
      expect(world.flows.list().connections).toHaveLength(0);
    });
  });

  it("a new address needs the token again; a rename keeps the token; a new token alone is sensitive", async () => {
    await withFlowWorld(async (world) => {
      const id = await addFzap(world);
      await expect(world.connections.update(id, { origin: "https://outra.exemplo.com.br" }, opts)).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        messageKey: "error.flowConnectionKeyAgain",
        details: { fields: ["credential"] },
      });
      expect(world.flows.list().connections[0]?.origin).toBe(`https://${HOST}`);
      // The same address again is no move.
      expect(await world.connections.update(id, { origin: `https://${HOST}`, name: "fzap" }, opts)).toEqual({ sensitive: false });
      expect(world.flows.list().connections[0]).toMatchObject({ name: "fzap", keyEnd: "9b3c" });
      expect(await world.connections.update(id, { origin: "https://outra.exemplo.com.br", credential: "token-da-outra-instancia-77aa" }, opts)).toEqual({ sensitive: true });
      expect(world.flows.list().connections[0]).toMatchObject({ origin: "https://outra.exemplo.com.br", keyEnd: "77aa" });
      expect(await new McpCredentials(testEnv.MCP_CREDENTIAL_KEY, "fzap-v1").decrypt(id, sealed(world, id) as string)).toBe("token-da-outra-instancia-77aa");
      expect(await world.connections.update(id, { credential: "token-novo-da-instancia-12cd" }, opts)).toEqual({ sensitive: true });
      expect(activity(world).filter((row) => row.action === "flow.connection_changed")).toHaveLength(2);
      // Empty, private address or another kind's field: refused, nothing changes.
      await expect(world.connections.update(id, {}, opts)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      await expect(world.connections.update(id, { origin: "https://10.0.0.1", credential: "token-de-rede-interna-0000" }, opts)).rejects.toMatchObject({ details: { fields: ["origin"] } });
      await expect(world.connections.update(id, { inboxId: 7 }, opts)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
      expect(world.flows.list().connections[0]).toMatchObject({ origin: "https://outra.exemplo.com.br", keyEnd: "12cd" });
    });
  });

  it("a change that meets another one meanwhile is refused (CONFLICT)", async () => {
    await withFlowWorld(async (world) => {
      const id = await addFzap(world);
      const results = await Promise.allSettled([world.connections.update(id, { credential: "token-um-da-instancia-aaaa" }, opts), world.connections.update(id, { credential: "token-dois-da-instancia-bbbb" }, opts)]);
      expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
      expect((results.find((result) => result.status === "rejected") as PromiseRejectedResult).reason).toMatchObject({ code: "CONFLICT" });
    });
  });

  it("counts toward the shared ceiling of credentials", async () => {
    await withFlowWorld(async (world) => {
      for (let i = 0; i < FLOW_LIMITS.connections - 1; i++) await addConnection(world, { name: `C${i}` });
      await addFzap(world);
      await expect(addFzap(world, { name: "Outra" })).rejects.toMatchObject({ code: "CONFLICT", messageKey: "error.flowConnectionLimit" });
    });
  });
});

describe("Testar the fzap", () => {
  it("reads only the session's state, with the token header, and tells the three states", async () => {
    await withFlowWorld(async (world) => {
      const id = await addFzap(world);
      const cases: [Record<string, unknown>, unknown][] = [
        [{ connected: true, loggedIn: true }, { connected: true, loggedIn: true, cloud: false }],
        [{ connected: true, loggedIn: true, cloudapi: { phoneNumberId: "1" } }, { connected: true, loggedIn: true, cloud: true }],
        [{ connected: false, loggedIn: false }, { connected: false, loggedIn: false, cloud: false }],
        [{ connected: true, loggedIn: false, cloudapi: null, jid: "x", extra: "<script>" }, { connected: true, loggedIn: false, cloud: false }],
      ];
      for (const [data, fzap] of cases) {
        world.network.handlers.set(HOST, status(data));
        world.clock.now += 20_000;
        expect(await world.flows.testConnection(id)).toEqual({ ok: true, ms: 0, status: null, inboxes: null, fzap });
      }
      for (const request of world.network.requests) {
        expect(request.method).toBe("GET");
        expect(new URL(request.url).pathname).toBe("/session/status");
        expect(request.headers.get("token")).toBe(TOKEN);
        expect(request.headers.get("authorization")).toBeNull();
      }
      // The test changes nothing.
      expect(world.flows.list().connections[0]).toMatchObject({ origin: `https://${HOST}`, keyEnd: "9b3c" });
    });
  });

  it("says why it didn't pass: refused token, answer out of shape, redirect, private address", async () => {
    await withFlowWorld(async (world) => {
      const id = await addFzap(world);
      const cases: [() => void, unknown][] = [
        [() => world.network.handlers.set(HOST, () => Response.json({ code: 401, success: false, error: "unauthorized" }, { status: 401 })), { ok: false, problem: "http_error", status: 401 }],
        [() => world.network.handlers.set(HOST, status({ connected: "yes", loggedIn: true })), { ok: false, problem: "bad_answer", status: null }],
        [() => world.network.handlers.set(HOST, () => Response.json({ connected: true, loggedIn: true })), { ok: false, problem: "bad_answer", status: null }],
        [() => world.network.handlers.set(HOST, () => new Response(null, { status: 302, headers: { location: "https://outro.exemplo.com.br" } })), { ok: false, problem: "redirect", status: null }],
        [
          () => {
            world.network.handlers.set(HOST, status({ connected: true, loggedIn: true }));
            world.network.addresses.set(HOST, ["10.0.0.5"]);
          },
          { ok: false, problem: "private_address", status: null },
        ],
      ];
      for (const [arrange, expected] of cases) {
        arrange();
        world.clock.now += 20_000;
        expect(await world.flows.testConnection(id)).toEqual(expected);
      }
    });
  });

  it("a token sealed for another kind doesn't open, and nothing goes out", async () => {
    await withFlowWorld(async (world) => {
      world.network.handlers.set(HOST, status({ connected: true, loggedIn: true }));
      const id = await addFzap(world);
      const wrong = await new McpCredentials(testEnv.MCP_CREDENTIAL_KEY, "chatwoot-v1").encrypt(id, TOKEN);
      world.db.run(`UPDATE zur_flow_connections SET credential = ? WHERE id = ?`, wrong, id);
      expect(await world.flows.testConnection(id)).toEqual({ ok: false, problem: "credential", status: null });
      expect(world.network.requests).toHaveLength(0);
    });
  });

  it("runs at most 5 times a minute", async () => {
    await withFlowWorld(async (world) => {
      world.network.handlers.set(HOST, status({ connected: true, loggedIn: true }));
      const id = await addFzap(world);
      for (let i = 0; i < 5; i++) expect((await world.flows.testConnection(id)).ok).toBe(true);
      await expect(world.flows.testConnection(id)).rejects.toMatchObject({ code: "RATE_LIMITED" });
      expect(world.network.requests).toHaveLength(5);
    });
  });
});

describe("flows and the fzap credential", () => {
  it("a flow can't be saved calling it, and a flow whose credential became one never calls it", async () => {
    await withFlowWorld(async (world) => {
      world.network.handlers.set(HOST, status({ connected: true, loggedIn: true }));
      const fzap = await addFzap(world);
      await expect(world.flows.create({ name: "Pix", definition: manual([get(fzap, "/chat/send/pix")]) })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        messageKey: "error.flowConnectionKind",
      });
      const http = await addConnection(world);
      world.network.handlers.set("api.exemplo.com.br", () => Response.json({}));
      const flow = await world.flows.create({ name: "X", definition: manual([get(http, "/v1/a")]) });
      world.db.run(`UPDATE zur_flow_connections SET kind = 'fzap' WHERE id = ?`, http);
      expect((await world.flows.runNow(flow.id)).problem).toBe("kind_not_allowed");
      expect(world.network.requests).toHaveLength(0);
    });
  });
});
