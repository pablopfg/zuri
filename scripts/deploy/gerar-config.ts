// Writes the Wrangler config of the production deploy (.github/workflows/deploy.yml,
// docs/instalacao-cloudflare.md):
//
//   node scripts/deploy/gerar-config.ts   reads apps/agent/wrangler.jsonc, writes apps/agent/wrangler.deploy.json
//
// The repository is public, so nothing personal is in wrangler.jsonc. What only
// the owner's installation has comes from secrets of the GitHub "production"
// environment (secrets, not variables: the runner masks them from the first
// byte of the log), read here from the process environment:
//
//   ZURI_DOMAIN          required: the Custom Domain (zuri.exemplo.com.br)
//   ZURI_ALERT_EMAIL_TO  optional: the verified address the SEND_EMAIL binding may write to
//   ZURI_BACKUP_BUCKET   optional (R2 ⚠): the private bucket of the BACKUP_BUCKET binding
//
// The Worker's secrets never pass through here: the owner sets them in the
// dashboard and a deploy keeps them. The values read here never reach the log
// either (the job masks them first, and the errors only name the variable).
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const BASE_CONFIG = "apps/agent/wrangler.jsonc";
/** Next to the base, so its relative paths (main, assets, $schema) still resolve. Ignored by Git. */
export const DEPLOY_CONFIG = "apps/agent/wrangler.deploy.json";

export class ConfigError extends Error {}

// A plain host name with two labels or more: no scheme, port, path, wildcard or trailing dot.
const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/;
// Cloudflare's own shared hosts: the Worker must answer only on the owner's domain.
const SHARED_HOST = /(?:^|\.)(?:workers|pages)\.dev$/;
const EMAIL = /^[A-Za-z0-9._%+-]{1,64}@(?=.{4,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$/;
// R2 bucket names: 3 to 63 lowercase letters, digits and dashes, not starting or ending with a dash.
const BUCKET = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/;

/** The deploy variables, as the workflow passes them (unset and empty mean the same). */
export interface DeployVars {
  ZURI_DOMAIN?: string;
  ZURI_ALERT_EMAIL_TO?: string;
  ZURI_BACKUP_BUCKET?: string;
}

type Config = Record<string, unknown> & { assets?: Record<string, unknown> };

/** Removes // and /* *\/ comments and trailing commas from JSONC, leaving the strings alone. */
export function stripJsonc(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < text.length && text[j] !== '"') j += text[j] === "\\" ? 2 : 1;
      out += text.slice(i, j + 1);
      i = j + 1;
    } else if (ch === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
    } else if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) throw new ConfigError("unterminated block comment in the base config");
      i = end + 2;
    } else {
      out += ch;
      i++;
    }
  }
  return withoutTrailingCommas(out);
}

/** Drops a comma followed only by blanks before } or ], outside strings. */
function withoutTrailingCommas(json: string): string {
  let out = "";
  let i = 0;
  while (i < json.length) {
    const ch = json[i];
    if (ch === '"') {
      let j = i + 1;
      while (j < json.length && json[j] !== '"') j += json[j] === "\\" ? 2 : 1;
      out += json.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (ch === ",") {
      let j = i + 1;
      while (j < json.length && /\s/.test(json[j] ?? "")) j++;
      if (json[j] === "}" || json[j] === "]") {
        i++;
        continue;
      }
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * The value exactly as given. One with blanks or capitals around would be written
 * in another form than the one the runner masks (it masks the exact text), and the
 * normalized form would show in the public log: it is refused instead.
 */
function exact(raw: string | undefined, name: string, lower: boolean): string {
  const text = raw ?? "";
  const normal = lower ? text.trim().toLowerCase() : text.trim();
  if (text !== normal) throw new ConfigError(`${name} must be written without blanks around${lower ? " and in lowercase" : ""}`);
  return text;
}

/** The deploy config: the base plus the owner's domain and optional bindings, with every exposure off. */
export function renderDeployConfig(base: Config, vars: DeployVars): Config {
  const domain = exact(vars.ZURI_DOMAIN, "ZURI_DOMAIN", true);
  if (!domain) throw new ConfigError("ZURI_DOMAIN is required (secret of the production environment)");
  if (!HOSTNAME.test(domain) || SHARED_HOST.test(domain)) {
    throw new ConfigError("ZURI_DOMAIN must be the host alone, on your own domain, without https:// or a path");
  }
  const email = exact(vars.ZURI_ALERT_EMAIL_TO, "ZURI_ALERT_EMAIL_TO", false);
  if (email && !EMAIL.test(email)) throw new ConfigError("ZURI_ALERT_EMAIL_TO is not an e-mail address");
  const bucket = exact(vars.ZURI_BACKUP_BUCKET, "ZURI_BACKUP_BUCKET", false);
  if (bucket && (!BUCKET.test(bucket) || bucket.includes("--"))) {
    throw new ConfigError("ZURI_BACKUP_BUCKET is not an R2 bucket name (3 to 63 lowercase letters, digits and dashes)");
  }
  // These come from the variables only: one written into the base would bypass the checks above.
  for (const key of ["routes", "route", "send_email", "r2_buckets"]) {
    if (key in base) throw new ConfigError(`the base config must not set "${key}": it comes from the deploy variables`);
  }
  if (!base.assets) throw new ConfigError("the base config must serve the web interface (assets)");

  const config: Config = structuredClone(base);
  // Only the Custom Domain: no *.workers.dev address and no preview URL of any uploaded version.
  config.workers_dev = false;
  config.preview_urls = false;
  config.routes = [{ pattern: domain, custom_domain: true }];
  // The Worker meets every request first, so the interface passes the same gates as the API.
  config.assets = { ...config.assets, binding: "ASSETS", run_worker_first: true };
  // Email Routing sends only to this verified address (step 11c), whatever the code asks.
  if (email) config.send_email = [{ name: "SEND_EMAIL", destination_address: email }];
  // R2 ⚠ (approved by the owner on 02/11/2026): without the variable the automatic backup stays off.
  if (bucket) config.r2_buckets = [{ binding: "BACKUP_BUCKET", bucket_name: bucket }];
  return config;
}

export function main(root: string, env: NodeJS.ProcessEnv): Config {
  const base = JSON.parse(stripJsonc(readFileSync(join(root, BASE_CONFIG), "utf8"))) as Config;
  const config = renderDeployConfig(base, env);
  writeFileSync(join(root, DEPLOY_CONFIG), `${JSON.stringify(config, null, 2)}\n`);
  return config;
}

if (import.meta.main) {
  try {
    const config = main(join(import.meta.dirname, "..", ".."), process.env);
    // Names only: the domain, the address and the bucket stay out of a public log.
    const optional = [config.send_email ? "SEND_EMAIL" : null, config.r2_buckets ? "BACKUP_BUCKET" : null].filter(Boolean);
    console.log(`deploy config written: Custom Domain only, optional bindings: ${optional.join(", ") || "none"}`);
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}
