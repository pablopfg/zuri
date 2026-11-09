import { describe, expect, it } from "vitest";
import { checkAddresses, checkHealth, type Fetch, type Io, maskAccountName, WORKER_NAME } from "../../scripts/deploy/conferir-producao.ts";
import { BASE_CONFIG, ConfigError, renderDeployConfig, stripJsonc } from "../../scripts/deploy/gerar-config.ts";
import { planPublish } from "../../scripts/deploy/publicar-release.ts";
import { loadWorkflow, readText, triggers } from "./helpers.ts";

const base = () => JSON.parse(stripJsonc(readText(BASE_CONFIG))) as Record<string, unknown> & { assets: Record<string, unknown> };
const DOMAIN = "zuri.exemplo.com.br";

describe("deploy config (scripts/deploy/gerar-config.ts)", () => {
  it("reads the real wrangler.jsonc, comments and all", () => {
    const config = base();
    expect(config.name).toBe(WORKER_NAME);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
  });

  it("keeps strings that look like comments or trailing commas", () => {
    expect(JSON.parse(stripJsonc('{ "a": "https://x//y", "b": "/* no */", "c": "x,}", }'))).toEqual({ a: "https://x//y", b: "/* no */", c: "x,}" });
    expect(JSON.parse(stripJsonc('[1, 2, // two\n]'))).toEqual([1, 2]);
    expect(() => stripJsonc("{ /* open")).toThrow(ConfigError);
  });

  it("serves only the Custom Domain, with workers.dev and preview URLs off", () => {
    const config = renderDeployConfig({ ...base(), workers_dev: true, preview_urls: true, assets: { directory: "x", run_worker_first: false } }, { ZURI_DOMAIN: DOMAIN });
    expect(config.routes).toEqual([{ pattern: DOMAIN, custom_domain: true }]);
    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
    expect(config.assets).toEqual({ directory: "x", binding: "ASSETS", run_worker_first: true });
    expect(config).not.toHaveProperty("send_email");
    expect(config).not.toHaveProperty("r2_buckets");
  });

  it("keeps everything else of the base, secrets list included, without touching the original", () => {
    const original = base();
    const config = renderDeployConfig(original, { ZURI_DOMAIN: DOMAIN });
    expect(config.secrets).toEqual(original.secrets);
    expect(config.durable_objects).toEqual(original.durable_objects);
    expect(config.migrations).toEqual(original.migrations);
    expect(config.vars).toEqual(original.vars);
    expect(original).not.toHaveProperty("routes");
  });

  it("restricts SEND_EMAIL to the owner's verified address", () => {
    const config = renderDeployConfig(base(), { ZURI_DOMAIN: DOMAIN, ZURI_ALERT_EMAIL_TO: "dono@exemplo.com.br" });
    expect(config.send_email).toEqual([{ name: "SEND_EMAIL", destination_address: "dono@exemplo.com.br" }]);
  });

  it("binds BACKUP_BUCKET only when the bucket variable is set (R2 ⚠)", () => {
    const config = renderDeployConfig(base(), { ZURI_DOMAIN: DOMAIN, ZURI_BACKUP_BUCKET: "zuri-backup" });
    expect(config.r2_buckets).toEqual([{ binding: "BACKUP_BUCKET", bucket_name: "zuri-backup" }]);
    expect(renderDeployConfig(base(), { ZURI_DOMAIN: DOMAIN, ZURI_BACKUP_BUCKET: "" })).not.toHaveProperty("r2_buckets");
  });

  it.each([
    ["", /required/],
    ["https://zuri.exemplo.com.br", /host alone/],
    ["zuri.exemplo.com.br/", /host alone/],
    ["zuri.exemplo.com.br:8443", /host alone/],
    ["*.exemplo.com.br", /host alone/],
    ["localhost", /host alone/],
    ["zuri.conta.workers.dev", /own domain/],
    ["zuri.pages.dev", /own domain/],
    ["zuri.exemplo.com.br.", /host alone/],
  ])("refuses the domain %j", (domain, message) => {
    expect(() => renderDeployConfig(base(), { ZURI_DOMAIN: domain })).toThrow(message);
  });

  it.each([
    ["ZURI_DOMAIN", "Zuri.Exemplo.com.br"],
    ["ZURI_DOMAIN", ` ${DOMAIN}`],
    ["ZURI_DOMAIN", `${DOMAIN}\n`],
    ["ZURI_ALERT_EMAIL_TO", "dono@exemplo.com.br "],
    ["ZURI_BACKUP_BUCKET", " zuri-backup"],
  ])("refuses %s written in another form than the one the runner masks (%j)", (name, raw) => {
    expect(() => renderDeployConfig(base(), { ZURI_DOMAIN: DOMAIN, [name]: raw })).toThrow(new RegExp(`${name} must be written without blanks`));
  });

  it.each(["dono", "dono@", "@exemplo.com.br", "dono@exemplo", "a b@exemplo.com.br", "dono@exemplo.com.br\nBcc: x@y.z"])("refuses the address %j", (email) => {
    expect(() => renderDeployConfig(base(), { ZURI_DOMAIN: DOMAIN, ZURI_ALERT_EMAIL_TO: email })).toThrow(/ZURI_ALERT_EMAIL_TO/);
  });

  it.each(["ab", "Zuri-Backup", "-zuri", "zuri-", "zuri_backup", "zuri--backup", "a".repeat(64), "zuri backup"])("refuses the bucket %j", (bucket) => {
    expect(() => renderDeployConfig(base(), { ZURI_DOMAIN: DOMAIN, ZURI_BACKUP_BUCKET: bucket })).toThrow(/ZURI_BACKUP_BUCKET/);
  });

  it("accepts bucket names at both length limits", () => {
    for (const bucket of ["abc", "a".repeat(63)]) {
      expect(renderDeployConfig(base(), { ZURI_DOMAIN: DOMAIN, ZURI_BACKUP_BUCKET: bucket }).r2_buckets).toEqual([{ binding: "BACKUP_BUCKET", bucket_name: bucket }]);
    }
  });

  it.each(["routes", "route", "send_email", "r2_buckets"])("refuses a base config that sets %s itself", (key) => {
    expect(() => renderDeployConfig({ ...base(), [key]: [] }, { ZURI_DOMAIN: DOMAIN })).toThrow(/must not set/);
  });

  it("refuses a base config without the interface", () => {
    const { assets: _, ...withoutAssets } = base();
    expect(() => renderDeployConfig(withoutAssets, { ZURI_DOMAIN: DOMAIN })).toThrow(/assets/);
  });

  it("never names a value in its errors", () => {
    for (const vars of [
      { ZURI_DOMAIN: "https://segredo.exemplo.com.br" },
      { ZURI_DOMAIN: DOMAIN, ZURI_ALERT_EMAIL_TO: "segredo@" },
      { ZURI_DOMAIN: DOMAIN, ZURI_BACKUP_BUCKET: "Segredo" },
    ]) {
      expect(() => renderDeployConfig(base(), vars)).toThrow(ConfigError);
      expect(() => renderDeployConfig(base(), vars)).not.toThrow(/segredo/i);
    }
  });
});

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeIo(answers: Record<string, () => Response>): Io & { calls: Call[]; waits: number[] } {
  const calls: Call[] = [];
  const waits: number[] = [];
  const fetch: Fetch = async (url, init) => {
    calls.push({ url, init });
    const answer = answers[url];
    if (!answer) throw new TypeError("fetch failed");
    return answer();
  };
  return { fetch, calls, waits, sleep: async (ms) => void waits.push(ms), out: () => {} };
}

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const API = `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers`;
const env = { CLOUDFLARE_API_TOKEN: "token-de-teste", CLOUDFLARE_ACCOUNT_ID: ACCOUNT };
const cf = (result: unknown, status = 200) => () => Response.json({ success: status < 400, result }, { status });

describe("workers.dev and preview URL check", () => {
  it("passes when both are off and the workers.dev address answers nothing", async () => {
    const io = fakeIo({ [`${API}/scripts/zuri/subdomain`]: cf({ enabled: false, previews_enabled: false }), [`${API}/subdomain`]: cf({ subdomain: "minhaconta" }) });
    const result = await checkAddresses(env, io);
    expect(result.ok).toBe(true);
    expect(result.lines[0]).toBe("::add-mask::minhaconta");
    expect(io.calls.map((c) => c.url)).toContain("https://zuri.minhaconta.workers.dev/api/health");
  });

  it("sends the token only to Cloudflare's API, never to the probed address", async () => {
    const io = fakeIo({
      [`${API}/scripts/zuri/subdomain`]: cf({ enabled: false, previews_enabled: false }),
      [`${API}/subdomain`]: cf({ subdomain: "minhaconta" }),
      "https://zuri.minhaconta.workers.dev/": () => new Response("", { status: 404 }),
    });
    await checkAddresses(env, io);
    for (const call of io.calls) {
      const sent = JSON.stringify(call.init?.headers ?? {});
      if (call.url.startsWith("https://api.cloudflare.com/")) expect(sent).toContain("token-de-teste");
      else expect(sent).not.toContain("token-de-teste");
    }
  });

  it.each([
    [{ enabled: true, previews_enabled: false }, /workers\.dev is on/],
    [{ enabled: false, previews_enabled: true }, /preview URLs are on/],
    [{ enabled: true, previews_enabled: true }, /must be off/],
  ])("fails when %j", async (state, message) => {
    const result = await checkAddresses(env, fakeIo({ [`${API}/scripts/zuri/subdomain`]: cf(state) }));
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatch(message);
  });

  it.each([
    ["an API error", cf(null, 403)],
    ["an answer without the fields", cf({})],
    ["fields of another type", cf({ enabled: "false", previews_enabled: false })],
    ["a body that is not JSON", () => new Response("<html>")],
  ])("fails closed on %s", async (_, answer) => {
    const result = await checkAddresses(env, fakeIo({ [`${API}/scripts/zuri/subdomain`]: answer }));
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatch(/could not read/);
  });

  it("fails closed when the API does not answer", async () => {
    expect((await checkAddresses(env, fakeIo({}))).ok).toBe(false);
  });

  it("fails when the workers.dev address still serves a page", async () => {
    const io = fakeIo({
      [`${API}/scripts/zuri/subdomain`]: cf({ enabled: false, previews_enabled: false }),
      [`${API}/subdomain`]: cf({ subdomain: "minhaconta" }),
      "https://zuri.minhaconta.workers.dev/": () => new Response("ok"),
    });
    const result = await checkAddresses(env, io);
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatch(/still answers \//);
  });

  it("passes when the account clearly has no workers.dev subdomain", async () => {
    for (const result of [{}, { subdomain: "" }, { subdomain: null }]) {
      const io = fakeIo({ [`${API}/scripts/zuri/subdomain`]: cf({ enabled: false, previews_enabled: false }), [`${API}/subdomain`]: cf(result) });
      expect((await checkAddresses(env, io)).ok).toBe(true);
      expect(io.calls.some((c) => c.url.includes(".workers.dev"))).toBe(false);
    }
  });

  it("passes when Cloudflare answers that the account has no workers.dev subdomain (10007)", async () => {
    const io = fakeIo({
      [`${API}/scripts/zuri/subdomain`]: cf({ enabled: false, previews_enabled: false }),
      [`${API}/subdomain`]: () => Response.json({ success: false, errors: [{ code: 10007, message: "not found" }], result: null }, { status: 404 }),
    });
    expect((await checkAddresses(env, io)).ok).toBe(true);
  });

  it.each([
    ["another API error code", () => Response.json({ success: false, errors: [{ code: 10000 }] }, { status: 403 })],
    ["a malformed subdomain", cf({ subdomain: "conta.outra" })],
    ["another malformed subdomain", cf({ subdomain: "-x" })],
    ["an API error", cf(null, 403)],
    ["a body that is not JSON", () => new Response("<html>")],
  ])("fails closed on %s for the account's subdomain", async (_, answer) => {
    const io = fakeIo({ [`${API}/scripts/zuri/subdomain`]: cf({ enabled: false, previews_enabled: false }), [`${API}/subdomain`]: answer });
    const result = await checkAddresses(env, io);
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatch(/workers\.dev subdomain/);
    expect(io.calls.some((c) => c.url.includes(".workers.dev"))).toBe(false);
  });

  it("fails closed when the account's subdomain does not answer", async () => {
    const io = fakeIo({ [`${API}/scripts/zuri/subdomain`]: cf({ enabled: false, previews_enabled: false }) });
    expect((await checkAddresses(env, io)).ok).toBe(false);
  });

  it.each([
    [{}, "no token"],
    [{ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "conta" }, "a malformed account id"],
    [{ CLOUDFLARE_API_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: `${ACCOUNT}/../x` }, "a path in the account id"],
  ])("refuses to call the API with %s", async (bad: NodeJS.ProcessEnv, _case: string) => {
    const io = fakeIo({});
    expect((await checkAddresses(bad, io)).ok).toBe(false);
    expect(io.calls).toEqual([]);
  });

  it("never prints the token", async () => {
    const io = fakeIo({ [`${API}/scripts/zuri/subdomain`]: cf({ enabled: true, previews_enabled: true }) });
    expect((await checkAddresses(env, io)).lines.join("\n")).not.toContain("token-de-teste");
  });
});

describe("account name mask", () => {
  it("masks the account name, whole and by its longer pieces, before wrangler can print it", async () => {
    const io = fakeIo({ [`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`]: cf({ name: "dono@exemplo.com.br's Account" }) });
    const result = await maskAccountName(env, io);
    expect(result).toEqual({ ok: true, lines: ["::add-mask::dono@exemplo.com.br's Account", "::add-mask::dono@exemplo.com.br's", "::add-mask::Account"] });
    expect(JSON.stringify(io.calls[0]?.init?.headers)).toContain("token-de-teste");
  });

  it.each([
    ["an API error", cf(null, 403)],
    ["no name", cf({})],
    ["a blank name", cf({ name: "  " })],
  ])("prints nothing and never fails on %s", async (_, answer) => {
    expect(await maskAccountName(env, fakeIo({ [`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}`]: answer }))).toEqual({ ok: true, lines: [] });
  });

  it("prints nothing without the API answering or without credentials", async () => {
    expect(await maskAccountName(env, fakeIo({}))).toEqual({ ok: true, lines: [] });
    const io = fakeIo({});
    expect(await maskAccountName({}, io)).toEqual({ ok: true, lines: [] });
    expect(io.calls).toEqual([]);
  });
});

describe("health and HTTPS check", () => {
  const health = `https://${DOMAIN}/api/health`;
  const plain = `http://${DOMAIN}/`;
  const redirect = (to: string, status = 301) => () => new Response(null, { status, headers: { location: to } });

  it("passes when the health check answers 200 and http:// moves to https://", async () => {
    const result = await checkHealth({ ZURI_DOMAIN: DOMAIN }, fakeIo({ [health]: () => new Response("{}"), [plain]: redirect(`https://${DOMAIN}/`) }));
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).not.toContain(DOMAIN);
  });

  it("accepts Cloudflare Access asking for the sign-in", async () => {
    const access = redirect("https://equipe.cloudflareaccess.com/cdn-cgi/access/login/x", 302);
    const result = await checkHealth({ ZURI_DOMAIN: DOMAIN }, fakeIo({ [health]: access, [plain]: access }));
    expect(result.ok).toBe(true);
    expect(result.lines.join("\n")).toMatch(/::notice::Cloudflare Access/);
  });

  it("tries again, further apart each time, while the certificate is new", async () => {
    let n = 0;
    const io = fakeIo({ [health]: () => new Response(null, { status: ++n < 3 ? 525 : 200 }), [plain]: redirect(`https://${DOMAIN}/`) });
    expect((await checkHealth({ ZURI_DOMAIN: DOMAIN }, io)).ok).toBe(true);
    expect(io.waits).toEqual([5_000, 10_000]);
  });

  it("tries six times by default, 5 s further apart each time", async () => {
    const io = fakeIo({ [health]: () => new Response(null, { status: 525 }) });
    expect((await checkHealth({ ZURI_DOMAIN: DOMAIN }, io)).ok).toBe(false);
    expect(io.waits).toEqual([5_000, 10_000, 15_000, 20_000, 25_000]);
  });

  it("names the missing secret's case on 503, after every try", async () => {
    const io = fakeIo({ [health]: () => new Response(null, { status: 503 }) });
    const result = await checkHealth({ ZURI_DOMAIN: DOMAIN }, io, 3);
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatch(/503: a Worker secret is missing/);
    expect(io.waits).toEqual([5_000, 10_000]);
  });

  it.each([
    ["a redirect elsewhere", redirect("https://outro.exemplo.com.br/", 302)],
    ["a 404", () => new Response(null, { status: 404 })],
  ])("fails on %s from the health check", async (_, answer) => {
    expect((await checkHealth({ ZURI_DOMAIN: DOMAIN }, fakeIo({ [health]: answer }), 1)).ok).toBe(false);
  });

  it.each([
    ["serves plain HTTP", () => new Response("ok")],
    ["redirects to another host", redirect("https://zuri.exemplo.com.br.evil.example/")],
    ["redirects to http://", redirect(`http://${DOMAIN}/`)],
  ])("fails when http:// %s", async (_, answer) => {
    const result = await checkHealth({ ZURI_DOMAIN: DOMAIN }, fakeIo({ [health]: () => new Response("{}"), [plain]: answer }));
    expect(result.ok).toBe(false);
    expect(result.lines.at(-1)).toMatch(/must redirect to https/);
  });

  it("refuses a missing or malformed domain without any request", async () => {
    for (const ZURI_DOMAIN of [undefined, "https://zuri.exemplo.com.br", "zuri.exemplo.com.br/x"]) {
      const io = fakeIo({});
      expect((await checkHealth({ ZURI_DOMAIN }, io)).ok).toBe(false);
      expect(io.calls).toEqual([]);
    }
  });
});

describe("release of main (scripts/deploy/publicar-release.ts)", () => {
  const changelog = (versions: string[]) =>
    [
      "# Changelog",
      "",
      "## [Não lançado]",
      "",
      ...versions.flatMap((v, i) => [
        `## [${v}] - 2026-11-0${9 - i} 10:00 (UTC-3) · [\`${"a".repeat(7)}\`](https://github.com/pablopfg/Zuri/commit/${"a".repeat(40)}) · [#${200 + i}](https://github.com/pablopfg/Zuri/pull/${200 + i})`,
        "",
        `Versão ${v}`,
        "",
        "### Adicionado",
        "",
        "- Algo.",
        "",
      ]),
    ].join("\n");

  it("publishes the newest version of main's changelog, with the published notes", () => {
    const real = readText("CHANGELOG.md");
    const planned = planPublish(real, () => true, () => []);
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.plan.tag).toMatch(/^v0\.\d+\.\d+$/);
    expect(planned.plan.title).toBe(planned.plan.tag);
    expect(planned.plan.notes).toContain("Versão publicada pela `main`.");
    expect(planned.plan.notes).not.toContain("não é deploy");
  });

  it("stops when the tag is missing or not in main's history", () => {
    const seen: string[] = [];
    const planned = planPublish(
      readText("CHANGELOG.md"),
      (tag) => {
        seen.push(tag);
        return false;
      },
      () => [],
    );
    expect(planned.ok).toBe(false);
    expect(seen).toHaveLength(1);
  });

  it("stops on a changelog without versions", () => {
    expect(planPublish(changelog([]), () => true, () => [])).toEqual({ ok: false, error: "CHANGELOG.md has no version yet" });
  });

  it("picks the newest version and compares it with the one before", () => {
    const real = readText("CHANGELOG.md");
    const versions = [...real.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
    const planned = planPublish(real, () => true, () => []);
    if (!planned.ok) throw new Error(planned.error);
    expect(planned.plan.tag).toBe(`v${versions[0]}`);
    expect(planned.plan.notes).toContain(`v${versions[1]}...v${versions[0]}`);
  });

  it("stops when develop reached main before its version was written, but not for the automatic merges", () => {
    const real = readText("CHANGELOG.md");
    const automatic = ["chore(release): versão 0.35.0", "docs(readme): atualiza o estado das etapas (automático)"];
    expect(planPublish(real, () => true, () => automatic).ok).toBe(true);
    const planned = planPublish(real, () => true, () => [...automatic, "feat(x): algo novo (#300)"]);
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.error).toMatch(/is not written yet \(1 merge/);
  });
});

describe("deploy workflow", () => {
  const wf = loadWorkflow(".github/workflows/deploy.yml");
  const text = readText(".github/workflows/deploy.yml");
  type Job = (typeof wf.jobs)[string] & { needs?: string; uses?: string; if?: string };
  const job = (id: string) => wf.jobs[id] as Job;
  const runs = (id: string) => (job(id).steps ?? []).map((s) => s.run ?? "").join("\n");

  it("runs only on a push to main or by hand, never on a pull request", () => {
    expect(wf.on).toEqual({ push: { branches: ["main"] }, workflow_dispatch: null });
    expect(triggers(wf)).not.toContain("pull_request");
    expect(text).toContain("group: deploy-production");
    expect(text).toContain("cancel-in-progress: false");
  });

  it("runs the whole CI on main first, then builds, deploys, checks and releases in order", () => {
    expect(job("ci").uses).toBe("./.github/workflows/ci.yml");
    expect(job("ci").if).toBe("github.ref == 'refs/heads/main'");
    expect(job("web").needs).toBe("ci");
    expect(job("deploy").needs).toBe("web");
    expect(job("release").needs).toBe("deploy");
  });

  it("is read-only at the top, and only the release job writes, to contents alone", () => {
    expect(wf.permissions).toEqual({ contents: "read" });
    for (const [id, j] of Object.entries(wf.jobs)) {
      if (id === "release") expect(j.permissions).toEqual({ contents: "write" });
      else if (j.permissions !== undefined) expect(j.permissions).toEqual({ contents: "read" });
    }
  });

  it("gives the Cloudflare secrets only to the deploy job, through the production environment", () => {
    expect(job("deploy").environment).toBe("production");
    for (const id of ["ci", "web", "release"]) {
      expect(job(id).environment, id).toBeUndefined();
      expect(JSON.stringify(job(id)), id).not.toMatch(/secrets\./);
    }
    expect(text).not.toMatch(/secrets: inherit/);
  });

  it("reads the installation's values only from secrets, which the runner masks in every step header", () => {
    // A variable shows in plain text in the "Run" header of the step that reads it, before any add-mask.
    expect(text).not.toMatch(/vars\./);
    const env = (job("deploy").steps ?? []).flatMap((s) => Object.entries(s.env ?? {}));
    for (const name of ["ZURI_DOMAIN", "ZURI_ALERT_EMAIL_TO", "ZURI_BACKUP_BUCKET"]) {
      expect(env.filter(([key]) => key === name).length, name).toBeGreaterThan(0);
      for (const [key, value] of env) if (key === name) expect(value).toBe(`\${{ secrets.${name} }}`);
    }
  });

  it("masks the account name before wrangler runs", () => {
    const deploy = runs("deploy");
    expect(deploy.indexOf("conferir-producao.ts mascarar")).toBeGreaterThanOrEqual(0);
    expect(deploy.indexOf("conferir-producao.ts mascarar")).toBeLessThan(deploy.indexOf("wrangler deploy"));
  });

  it("installs without scripts or cache next to the token", () => {
    expect(runs("deploy")).toContain("npm ci --ignore-scripts");
    const node = (job("deploy").steps ?? []).find((s) => s.uses?.startsWith("actions/setup-node@"));
    expect(node?.with?.cache).toBeUndefined();
    expect(node?.with?.["package-manager-cache"]).toBe(false);
  });

  it("deploys the generated config, then fails on workers.dev, previews or an unhealthy version", () => {
    const deploy = runs("deploy");
    const order = ["node scripts/deploy/gerar-config.ts", "wrangler deploy -c wrangler.deploy.json", "conferir-producao.ts enderecos", "conferir-producao.ts saude"];
    const positions = order.map((part) => deploy.indexOf(part));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(deploy).not.toMatch(/continue-on-error|\|\| true/);
    expect(text).not.toMatch(/continue-on-error/);
  });

  it("checks the deploy config and bundle on every pull request, without credentials", () => {
    const build = loadWorkflow(".github/workflows/ci.yml").jobs.build?.steps ?? [];
    const step = build.find((s) => s.run?.includes("scripts/deploy/gerar-config.ts"));
    expect(step?.run).toContain("wrangler deploy --dry-run -c wrangler.deploy.json");
    expect(JSON.stringify(step?.env)).toContain("exemplo.com.br");
  });

  it("keeps the generated config out of Git", () => {
    expect(readText(".gitignore")).toContain("apps/agent/wrangler.deploy.json");
  });
});
