import { apiErrorSchema, type Memory, type MemoryGraph, type MemoryCounts, type MemoryHistory, type MemoryReview, type MemoryWriteResult } from "@zuri/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { call, CSRF, HUMAN_TOKEN, ORIGIN, TEST_EMAIL, TEST_PASSWORD } from "./helpers.ts";

// Memories through the Worker, as the interface calls them.

const IP = "192.0.2.130";
let cookie = "";

const headers = (withCookie = true) => ({
  ...CSRF,
  "content-type": "application/json",
  "cf-connecting-ip": IP,
  "user-agent": "Mozilla/5.0 (X11; Linux x86_64) Chrome/140.0 Safari/537.36",
  ...(withCookie ? { cookie } : {}),
});

function api(method: string, path: string, body?: unknown, extra: Record<string, string> = {}) {
  return call(`${ORIGIN}/api${path}`, {
    method,
    headers: { ...headers(), ...extra },
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

async function json<T>(res: Response, status: number): Promise<T> {
  expect(res.status, await res.clone().text()).toBe(status);
  return (await res.json()) as T;
}

const refusal = async (res: Response, status: number) => apiErrorSchema.parse(await json(res, status));
const list = async (query = "") => json<{ memories: Memory[]; counts: MemoryCounts }>(await api("GET", `/memories${query}`), 200);
const create = async (content: string, category = "fact") => json<MemoryWriteResult>(await api("POST", "/memories", { content, category }), 201);

beforeAll(async () => {
  const res = await call(`${ORIGIN}/api/auth/login`, {
    method: "POST",
    headers: headers(false),
    body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD, turnstileToken: HUMAN_TOKEN }),
  });
  expect(res.status).toBe(200);
  cookie = res.headers.getSetCookie().find((c) => c.startsWith("__Host-zuri_session="))?.split(";")[0] ?? "";
});

const MISSING = "0b8f8a52-5b2c-4c55-9a4c-2f1f3e1f4a10";

describe("the memory routes", () => {
  const routes = [
    ["GET", "/memories"],
    ["POST", "/memories"],
    ["GET", "/memories/reviews"],
    ["GET", "/memories/graph"],
    ["POST", `/memories/reviews/${MISSING}`],
    ["GET", `/memories/${MISSING}`],
    ["PATCH", `/memories/${MISSING}`],
    ["DELETE", `/memories/${MISSING}`],
    ["GET", `/memories/${MISSING}/history`],
    ["POST", `/memories/${MISSING}/status`],
    ["POST", `/memories/${MISSING}/correct`],
    ["POST", `/memories/${MISSING}/local-only`],
  ] as const;

  it.each(routes)("%s %s needs a session (401) and the CSRF header (403), and is never cached", async (method, path) => {
    const anonymous = await call(`${ORIGIN}/api${path}`, { method, headers: headers(false) });
    expect((await refusal(anonymous, 401)).code).toBe("UNAUTHORIZED");
    expect(anonymous.headers.get("cache-control")).toBe("no-store");
    const { "x-zuri-request": _, ...withoutCsrf } = headers();
    const forged = await call(`${ORIGIN}/api${path}`, { method, headers: withoutCsrf });
    expect((await refusal(forged, 403)).code).toBe("CSRF_FAILED");
    const otherSite = await call(`${ORIGIN}/api${path}`, { method, headers: { ...headers(), origin: "https://evil.exemplo.com.br" } });
    expect((await refusal(otherSite, 403)).code).toBe("CSRF_FAILED");
  });

  it("an id that isn't one of the server's UUIDs is simply not found, on every route that takes one", async () => {
    for (const id of ["1", "../settings", "x".repeat(37), `${MISSING}%00`, "0B8F8A52-5B2C-4C55-9A4C-2F1F3E1F4A10"]) {
      const res = await api("GET", `/memories/${encodeURIComponent(id)}`);
      expect((await refusal(res, 404)).code).toBe("NOT_FOUND");
    }
    expect((await refusal(await api("DELETE", `/memories/${MISSING}`), 404)).message).toBe("Esta memória não existe mais.");
    expect((await refusal(await api("POST", `/memories/reviews/${MISSING}`, { action: "keep_both" }), 404)).message).toBe("Esta revisão já foi resolvida.");
  });

  it("refuses bad bodies naming only the fields, never echoing the text", async () => {
    const secret = "segredo-que-nao-volta";
    for (const [body, field] of [
      [{ content: "" }, "content"],
      [{ content: `${secret}${"x".repeat(2000)}` }, "content"],
      [{ content: secret, category: "nope" }, "category"],
      [{ content: secret, status: "historical" }, "_body"],
      [{ content: secret, origin: "telegram" }, "_body"],
      [[secret], "_body"],
    ] as const) {
      const res = await api("POST", "/memories", body);
      const error = await refusal(res, 400);
      expect(error.code).toBe("VALIDATION_FAILED");
      expect(error.details).toEqual({ fields: [field] });
      expect(JSON.stringify(error)).not.toContain(secret);
    }
    expect((await refusal(await api("POST", "/memories", "{not json"), 400)).code).toBe("VALIDATION_FAILED");
    expect((await refusal(await api("POST", "/memories", { content: "x" }, { "content-type": "text/plain" }), 400)).code).toBe("VALIDATION_FAILED");
    const huge = await api("POST", "/memories", { content: "x".repeat(20_000) });
    expect((await refusal(huge, 400)).message).toBeTruthy();
    expect((await refusal(await api("GET", "/memories?status=all&status=active"), 400)).details).toEqual({ fields: ["status"] });
    expect((await refusal(await api("GET", "/memories?limit=0"), 400)).code).toBe("VALIDATION_FAILED");
    expect((await refusal(await api("GET", "/memories?extra=1"), 400)).code).toBe("VALIDATION_FAILED");
  });

  it("the whole flow: save, duplicate, review, mark as past, history, restore, update the fact and delete", async () => {
    const vw = await create("Eu dirijo um Volkswagen");
    expect(vw).toMatchObject({ duplicate: false, reviews: 0, memory: { status: "active", origin: "app" } });
    const again = await json<MemoryWriteResult>(await api("POST", "/memories", { content: "eu DIRIJO um volkswagen" }), 200);
    expect(again).toMatchObject({ duplicate: true, memory: { id: vw.memory.id } });

    const tesla = await create("Vendi meu Volkswagen e comprei um Tesla");
    expect(tesla.reviews).toBe(1);
    const { reviews } = await json<{ reviews: MemoryReview[] }>(await api("GET", "/memories/reviews"), 200);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toMatchObject({ memory: { id: tesla.memory.id }, other: { id: vw.memory.id }, relationship: "possible_update", topic: "vehicle" });
    expect((await list()).counts).toMatchObject({ reviews: 1 });

    const bad = await refusal(await api("POST", `/memories/reviews/${reviews[0]?.id}`, { action: "drop_table" }), 400);
    expect(bad.details).toEqual({ fields: ["action"] });
    await json(await api("POST", `/memories/reviews/${reviews[0]?.id}`, { action: "mark_historical" }), 200);
    const past = (await list("?status=historical")).memories;
    expect(past.map((m) => m.id)).toEqual([vw.memory.id]);
    expect(past[0]?.supersededBy).toBe(tesla.memory.id);

    const history = await json<MemoryHistory>(await api("GET", `/memories/${tesla.memory.id}/history`), 200);
    expect(history.previous.map((m) => m.id)).toEqual([vw.memory.id]);

    const restored = await json<{ memory: Memory }>(await api("POST", `/memories/${vw.memory.id}/status`, { status: "active" }), 200);
    expect(restored.memory).toMatchObject({ status: "active", supersededBy: null });

    const corrected = await json<MemoryWriteResult>(await api("POST", `/memories/${vw.memory.id}/correct`, { content: "Eu dirijo uma Kombi" }), 201);
    expect(corrected.superseded.map((m) => m.id)).toEqual([vw.memory.id]);
    const same = await refusal(await api("POST", `/memories/${corrected.memory.id}/correct`, { content: "eu dirijo uma kombi" }), 400);
    expect(same.message).toContain("Editar");

    const edited = await json<MemoryWriteResult>(await api("PATCH", `/memories/${corrected.memory.id}`, { category: "preference" }), 200);
    expect(edited.memory.category).toBe("preference");
    expect((await refusal(await api("PATCH", `/memories/${corrected.memory.id}`, {}), 400)).code).toBe("VALIDATION_FAILED");

    const deleted = await api("DELETE", `/memories/${corrected.memory.id}`);
    expect(deleted.status).toBe(204);
    expect((await refusal(await api("GET", `/memories/${corrected.memory.id}`), 404)).code).toBe("NOT_FOUND");
    expect((await list("?q=Kombi")).memories).toEqual([]);
  });

  it("twenty identical saves at the same time store one memory", async () => {
    const text = `Fato simultâneo ${crypto.randomUUID()}`;
    const results = await Promise.all(Array.from({ length: 20 }, () => api("POST", "/memories", { content: text })));
    const statuses = results.map((res) => res.status).sort();
    expect(statuses.filter((s) => s === 201)).toHaveLength(1);
    expect(statuses.filter((s) => s === 200)).toHaveLength(19);
    expect((await list(`?q=${encodeURIComponent(text)}`)).memories).toHaveLength(1);
  });

  it("with conflict review off in the settings, a contradiction raises no review", async () => {
    const off = await api("PATCH", "/settings", { memoryConflictReview: false });
    expect(off.status).toBe(200);
    const before = (await list()).counts.reviews;
    await create("Moro em Manaus");
    expect((await create("Moro em Belém")).reviews).toBe(0);
    expect((await list()).counts.reviews).toBe(before);
    expect((await refusal(await api("PATCH", "/settings", { memoryConflictReview: "no" }), 400)).details).toEqual({ fields: ["memoryConflictReview"] });
    expect((await api("PATCH", "/settings", { memoryConflictReview: true })).status).toBe(200);
    expect((await create("Moro em Macapá")).reviews).toBeGreaterThan(0);
  });
});

describe("never send out (step 21, D3)", () => {
  it("marks a memory and takes the mark off, and refuses anything but a boolean", async () => {
    const { memory } = await create("Senha do cofre fica com a Ana");
    expect(memory.localOnly).toBe(false);
    const on = await json<{ memory: Memory }>(await api("POST", `/memories/${memory.id}/local-only`, { localOnly: true }), 200);
    expect(on.memory).toMatchObject({ id: memory.id, localOnly: true, updatedAt: memory.updatedAt });
    expect((await list()).memories.find((m) => m.id === memory.id)?.localOnly).toBe(true);
    for (const body of [{ localOnly: "yes" }, {}, { localOnly: true, extra: 1 }]) {
      expect((await refusal(await api("POST", `/memories/${memory.id}/local-only`, body), 400)).code).toBe("VALIDATION_FAILED");
    }
    expect((await refusal(await api("POST", `/memories/${MISSING}/local-only`, { localOnly: true }), 404)).code).toBe("NOT_FOUND");
    const off = await json<{ memory: Memory }>(await api("POST", `/memories/${memory.id}/local-only`, { localOnly: false }), 200);
    expect(off.memory.localOnly).toBe(false);
  });
});

describe("the map of the memory (Sinal, S06)", () => {
  const graph = async (query = "") => json<MemoryGraph>(await api("GET", `/memories/graph${query}`), 200);

  it("links a memory to the folder it names, to titles with two words in common and to memories near it", async () => {
    const folder = await json<{ project: { id: string } }>(await api("POST", "/projects", { name: "Mudança de apartamento" }), 201);
    const task = await json<{ task: { id: string } }>(await api("POST", "/tasks", { title: "Encaixotar livros da mudança do apartamento" }), 201);
    const note = await json<{ note: { id: string } }>(await api("POST", "/notes", { title: "Lista da mudança para o apartamento", content: "" }), 201);
    await api("POST", "/notes", { title: "Receita de bolo de cenoura", content: "" });
    const center = (await create("Está cuidando da mudança de apartamento para o bairro Água Verde")).memory;
    const near = (await create("Quer terminar a mudança para o apartamento novo até o dia 20")).memory;
    const far = (await create("Prefere chá de hortelã sem açúcar")).memory;

    const whole = await graph();
    expect(whole.truncated).toBe(false);
    const ids = whole.memories.map((m) => m.id);
    expect(ids).toEqual(expect.arrayContaining([center.id, near.id, far.id]));
    const to = (id: string) => whole.links.filter((l) => l.from === id || l.to === id);
    expect(to(center.id)).toEqual(
      expect.arrayContaining([
        { from: center.id, to: `folder:${folder.project.id}`, kind: "hub" },
        { from: center.id, to: `task:${task.task.id}`, kind: "hub" },
        { from: center.id, to: `note:${note.note.id}`, kind: "hub" },
      ]),
    );
    expect(to(center.id).some((l) => l.kind === "near" && [l.from, l.to].includes(near.id))).toBe(true);
    // One word in common, or none, links nothing.
    expect(to(far.id)).toEqual([]);
    expect(whole.hubs.find((h) => h.id === `folder:${folder.project.id}`)).toEqual({ id: `folder:${folder.project.id}`, kind: "folder", ref: folder.project.id, label: "Mudança de apartamento" });
    expect(whole.hubs.some((h) => h.label.includes("bolo"))).toBe(false);
    // Every link ends at something that came in the answer.
    const known = new Set([...ids, ...whole.hubs.map((h) => h.id)]);
    for (const link of whole.links) expect(known.has(link.from) && known.has(link.to), JSON.stringify(link)).toBe(true);

    // Around one memory: it, what touches it, and nothing else.
    const around = await graph(`?around=${center.id}`);
    expect(around.memories.map((m) => m.id)).toEqual(expect.arrayContaining([center.id, near.id]));
    expect(around.memories.some((m) => m.id === far.id)).toBe(false);
    expect(around.hubs.map((h) => h.kind).sort()).toEqual(["folder", "note", "task"]);
    const alone = await graph(`?around=${far.id}`);
    expect(alone).toEqual({ memories: [expect.objectContaining({ id: far.id })], hubs: [], links: [], truncated: false });
  });

  it("a fact and the one that replaced it are linked as versions", async () => {
    const old = (await create("Trabalha na padaria Trigo Dourado como gerente")).memory;
    const corrected = await json<MemoryWriteResult>(await api("POST", `/memories/${old.id}/correct`, { content: "Trabalha na livraria Entrelinhas como gerente" }), 201);
    const around = await graph(`?around=${corrected.memory.id}`);
    expect(around.links).toContainEqual({ from: old.id, to: corrected.memory.id, kind: "version" });
    expect(around.memories.find((m) => m.id === old.id)?.status).toBe("historical");
  });

  it("refuses an unknown memory, a bad id, a repeated or unknown parameter", async () => {
    expect((await refusal(await api("GET", `/memories/graph?around=${MISSING}`), 404)).code).toBe("NOT_FOUND");
    for (const query of ["?around=1", "?around=", `?around=${MISSING}&around=${MISSING}`, "?limit=5", `?around=${MISSING.toUpperCase()}x`]) {
      expect((await refusal(await api("GET", `/memories/graph${query}`), 400)).code, query).toBe("VALIDATION_FAILED");
    }
  });

  it("a memory's text can't turn the word search into syntax", async () => {
    const odd = (await create('NEAR("a" OR * AND ) -- "; DROP zur_memories \'')).memory;
    const around = await graph(`?around=${odd.id}`);
    expect(around.memories.map((m) => m.id)).toContain(odd.id);
  });
});
