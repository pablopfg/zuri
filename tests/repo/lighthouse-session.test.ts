import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { request } from "@playwright/test";
import { afterEach, describe, expect, it } from "vitest";
import { hasSession } from "../lighthouse/session.ts";

let server: Server | undefined;

afterEach(async () => {
  await new Promise((done) => server?.close(done) ?? done(undefined));
  server = undefined;
});

/** A stand-in for wrangler dev that counts the connections and answers the session route. */
async function sessionServer(status: number): Promise<{ baseURL: string; connections: () => number }> {
  let connections = 0;
  server = createServer((req, res) => {
    res.statusCode = req.url === "/api/auth/session" && req.headers["x-zuri-request"] === "1" ? status : 404;
    res.end("{}");
  });
  // Longer than the test: only the client can decide not to reuse the connection.
  server.keepAliveTimeout = 60_000;
  server.on("connection", () => {
    connections++;
  });
  await new Promise<void>((done) => server?.listen(0, "127.0.0.1", done));
  const { port } = server.address() as AddressInfo;
  return { baseURL: `http://127.0.0.1:${port}`, connections: () => connections };
}

describe("Lighthouse's session check (issue #336)", () => {
  it("opens a connection of its own each time, so a Lighthouse run can't leave it a stale one", async () => {
    const world = await sessionServer(200);
    const context = await request.newContext();
    try {
      expect(await hasSession(context, world.baseURL)).toBe(true);
      expect(await hasSession(context, world.baseURL)).toBe(true);
      expect(await hasSession(context, world.baseURL)).toBe(true);
    } finally {
      await context.dispose();
    }
    expect(world.connections()).toBe(3);
  });

  it("says no session when the server doesn't answer 200", async () => {
    const world = await sessionServer(401);
    const context = await request.newContext();
    try {
      expect(await hasSession(context, world.baseURL)).toBe(false);
    } finally {
      await context.dispose();
    }
  });
});
