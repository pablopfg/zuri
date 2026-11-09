// Checks the installation right after the deploy (.github/workflows/deploy.yml).
// A failed check fails the run, so a problem never passes for a green deploy:
//
//   node scripts/deploy/conferir-producao.ts enderecos   asks Cloudflare's API that workers.dev and the
//                                                        preview URLs are off, then that workers.dev answers nothing
//   node scripts/deploy/conferir-producao.ts saude       http:// goes to https://, and /api/health answers 200
//
// The repository's Actions log is public: only HTTP statuses and setting names are
// printed. The API token comes from the environment (CLOUDFLARE_API_TOKEN), never
// from the command line, and goes only to api.cloudflare.com.

export const WORKER_NAME = "zuri";
export const API = "https://api.cloudflare.com/client/v4";
const ACCOUNT_ID = /^[0-9a-f]{32}$/;
const SUBDOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
// Cloudflare Access sends a visitor without its cookie to the team's sign-in page.
const ACCESS_SIGN_IN = /^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com\//;

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

export interface Io {
  fetch: Fetch;
  sleep: (ms: number) => Promise<void>;
  /** One line of the job log. "::error::" and "::warning::" lines become annotations. */
  out: (line: string) => void;
}

export interface Result {
  ok: boolean;
  lines: string[];
}

const timeout = () => AbortSignal.timeout(15_000);

async function json(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * workers.dev and the preview URLs of the Worker, from Cloudflare itself. A probe
 * from outside alone is not enough: the Worker answers 404 on any host but the
 * owner's, so an exposed workers.dev would look closed. Anything unreadable fails.
 */
export async function checkAddresses(env: NodeJS.ProcessEnv, io: Io): Promise<Result> {
  const lines: string[] = [];
  const fail = (line: string): Result => ({ ok: false, lines: [...lines, `::error::${line}`] });
  const token = env.CLOUDFLARE_API_TOKEN ?? "";
  const account = (env.CLOUDFLARE_ACCOUNT_ID ?? "").trim();
  if (!token || !ACCOUNT_ID.test(account)) {
    return fail("CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID (32 hex digits) must be secrets of the production environment");
  }
  const headers = { authorization: `Bearer ${token}` };
  const base = `${API}/accounts/${account}/workers`;

  let state: { enabled?: unknown; previews_enabled?: unknown } | undefined;
  try {
    const response = await io.fetch(`${base}/scripts/${WORKER_NAME}/subdomain`, { headers, signal: timeout() });
    const body = (await json(response)) as { success?: boolean; result?: typeof state } | null;
    if (response.ok && body?.success === true) state = body.result;
    else lines.push(`workers.dev setting: HTTP ${response.status}`);
  } catch {
    lines.push("workers.dev setting: no answer");
  }
  if (typeof state?.enabled !== "boolean" || typeof state.previews_enabled !== "boolean") {
    return fail("could not read the workers.dev setting of the Worker: check the token's permissions (docs/instalacao-cloudflare.md)");
  }
  if (state.enabled || state.previews_enabled) {
    return fail(
      `workers.dev is ${state.enabled ? "on" : "off"} and preview URLs are ${state.previews_enabled ? "on" : "off"}: both must be off with your own domain`,
    );
  }
  lines.push("workers.dev and preview URLs: off");

  // From outside too: the account's workers.dev address must not serve anything.
  let subdomain = "";
  try {
    const response = await io.fetch(`${base}/subdomain`, { headers, signal: timeout() });
    const body = (await json(response)) as { result?: { subdomain?: unknown } } | null;
    const found = body?.result?.subdomain;
    if (response.ok && typeof found === "string" && SUBDOMAIN.test(found)) subdomain = found;
  } catch {
    // An account without a workers.dev subdomain has nothing to probe.
  }
  if (!subdomain) {
    lines.push("the account has no workers.dev subdomain to probe");
    return { ok: true, lines };
  }
  // The subdomain names the account: masked before it can appear anywhere.
  lines.unshift(`::add-mask::${subdomain}`);
  for (const path of ["/", "/api/health"]) {
    let status = 0;
    try {
      status = (await io.fetch(`https://${WORKER_NAME}.${subdomain}.workers.dev${path}`, { redirect: "manual", signal: timeout() })).status;
    } catch {
      // No answer at all is what a disabled address does.
    }
    lines.push(`workers.dev${path}: HTTP ${status || "no answer"}`);
    if (status >= 200 && status < 400) return fail(`the workers.dev address still answers ${path}`);
  }
  return { ok: true, lines };
}

/** Plain HTTP moves to HTTPS, and the health check answers 200 (or Access asks for the sign-in). */
export async function checkHealth(env: NodeJS.ProcessEnv, io: Io, attempts = 6): Promise<Result> {
  const lines: string[] = [];
  const fail = (line: string): Result => ({ ok: false, lines: [...lines, `::error::${line}`] });
  const domain = (env.ZURI_DOMAIN ?? "").trim().toLowerCase();
  if (!HOSTNAME.test(domain)) return fail("ZURI_DOMAIN is missing or not a host name");

  // A new Custom Domain may still be getting its certificate: a few tries, further apart each time.
  let status = 0;
  let location = "";
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await io.fetch(`https://${domain}/api/health`, { redirect: "manual", signal: timeout() });
      status = response.status;
      location = response.headers.get("location") ?? "";
    } catch {
      status = 0;
    }
    lines.push(`/api/health, try ${attempt}: HTTP ${status || "no answer"}`);
    if (status === 200 || (status >= 300 && status < 400 && ACCESS_SIGN_IN.test(location))) break;
    if (attempt < attempts) await io.sleep(attempt * 5_000);
  }
  if (status >= 300 && status < 400 && ACCESS_SIGN_IN.test(location)) {
    lines.push("::notice::Cloudflare Access is in front: open /api/health in your browser to see the answer");
  } else if (status !== 200) {
    return fail(
      status === 503
        ? "/api/health answered 503: a Worker secret is missing or invalid; the Worker's log names it (docs/solucao-de-problemas.md)"
        : "/api/health did not answer 200 (docs/solucao-de-problemas.md)",
    );
  }

  let plain = 0;
  let to = "";
  try {
    const response = await io.fetch(`http://${domain}/`, { redirect: "manual", signal: timeout() });
    plain = response.status;
    to = response.headers.get("location") ?? "";
  } catch {
    plain = 0;
  }
  lines.push(`http:// → HTTP ${plain || "no answer"}`);
  const toHttps = to.startsWith(`https://${domain}/`) || to === `https://${domain}` || ACCESS_SIGN_IN.test(to);
  if (![301, 302, 307, 308].includes(plain) || !toHttps) return fail("http:// must redirect to https:// on your own domain");
  return { ok: true, lines };
}

if (import.meta.main) {
  const io: Io = {
    fetch: (url, init) => fetch(url, init),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    out: (line) => console.log(line),
  };
  const command = process.argv[2];
  const check = command === "enderecos" ? checkAddresses : command === "saude" ? checkHealth : null;
  if (!check) {
    console.error("usage: node scripts/deploy/conferir-producao.ts enderecos|saude");
    process.exit(2);
  }
  const result = await check(process.env, io);
  for (const line of result.lines) io.out(line);
  if (!result.ok) process.exit(1);
}
