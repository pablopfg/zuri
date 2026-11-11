// Decides whether the browser jobs of ci.yml (e2e and lighthouse) have anything
// to test in a pull request. Both start the real Worker with the built
// interface, so a pull request that changes neither has nothing for them to
// find: the suite took 22 to 29 minutes per run in November 2026, and the
// release pull request (publicar-versao.ts) paid that for a version number.
//
// The rule is a short list of what is known to be text, never a list of what
// is code: any path outside it runs the browsers. The browsers are skipped
// only when every changed file is
//   - text nobody builds or serves (TEXT_ONLY: docs, changelog, the agent's
//     memory and rules, the root's Markdown files), or
//   - a file that carries the version of the system, changed in nothing but
//     that number (onlyVersionChanged): the release pull request.
// Anything unexpected (not a pull request, a base other than develop or main,
// no merge commit, an empty diff, an error) runs them. The job itself always runs and ends green: the rulesets
// require the "e2e" and "lighthouse" checks, and a workflow skipped by `paths`
// would leave the pull request waiting on them forever.
//
// The other jobs (typecheck, lint, test, i18n, build, audit, CodeQL) run on
// every pull request, whatever this says. Pushes to develop and the run before
// a deploy (workflow_call) always run the browsers too. A merge made by a
// workflow (the release pull request) starts no push run, so what covers the
// version files is the byte-for-byte comparison here, not a later run.
//
//   node scripts/precisa-de-e2e.ts   writes run=true|false to GITHUB_OUTPUT (EVENT_NAME and BASE_REF from the workflow)
import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { LOCK_FILE, VERSION_FILE } from "./versao.ts";

/** Text that no build, Worker or test in the browser reads. Checked against the whole path. */
const TEXT_ONLY: readonly RegExp[] = [
  // Documentation, plans, screenshots. `npm run lint` checks its .html files, and that job still runs.
  /^docs\//,
  // The fragments of each pull request and the file the Versão workflow writes from them.
  /^changelog\//,
  /^CHANGELOG\.md$/,
  // The agent's memory, rules and skills.
  /^\.claude\//,
  // Markdown at the root (README, AGENTS, CONTRIBUTING, SECURITY, NOTICE…) and the licence.
  /^[^/]+\.md$/,
  /^LICENSE$/,
];

export function isTextOnly(path: string): boolean {
  return TEXT_ONLY.some((pattern) => pattern.test(path));
}

const SEMVER = /^\d+\.\d+\.\d+$/;
type Json = Record<string, unknown>;
// As scripts/versao.ts writes them: two spaces and a final newline.
const render = (value: Json) => `${JSON.stringify(value, null, 2)}\n`;
const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/** The workspaces of a root package.json, as paths. */
export function workspacesOf(rootPackage: string): string[] {
  const { workspaces } = JSON.parse(rootPackage) as Json;
  return Array.isArray(workspaces) ? workspaces.filter((w): w is string => typeof w === "string") : [];
}

/** The files that carry the version of the system (versionFiles in scripts/versao.ts), from the base's workspaces. */
export function versionFilesOf(workspaces: readonly string[]): string[] {
  return [VERSION_FILE, "package.json", ...workspaces.map((w) => `${w}/package.json`), LOCK_FILE];
}

/**
 * True when `head` is `base` with another version of the system and nothing
 * else: the base is rewritten with the head's number the way writeVersion
 * does, and the result must be the head byte for byte. A dependency, a
 * script, a key in another order or a different indentation all fail.
 */
export function onlyVersionChanged(file: string, base: string, head: string, workspaces: readonly string[]): boolean {
  try {
    if (file === VERSION_FILE) {
      const line = /APP_VERSION = "([^"]*)"/;
      const version = line.exec(head)?.[1] ?? "";
      return SEMVER.test(version) && line.test(base) && base.replace(line, `APP_VERSION = "${version}"`) === head;
    }
    const from = JSON.parse(base) as unknown;
    const to = JSON.parse(head) as unknown;
    if (!isObject(from) || !isObject(to) || typeof to.version !== "string" || !SEMVER.test(to.version)) return false;
    if (file === LOCK_FILE) {
      // The entries that repeat the version: the top, the root package ("") and each workspace (lockEntries in versao.ts).
      const packages = isObject(from.packages) ? from.packages : {};
      for (const entry of [from, packages[""], ...workspaces.map((w) => packages[w])]) {
        if (isObject(entry) && "version" in entry) entry.version = to.version;
      }
      return render(from) === head;
    }
    if (!versionFilesOf(workspaces).includes(file) || !("version" in from)) return false;
    return render({ ...from, version: to.version }) === head;
  } catch {
    // Not JSON, or not what the script writes: not a version change.
    return false;
  }
}

export interface Change {
  path: string;
  /** The file on the base branch and in the pull request; null where it does not exist. */
  read: () => { base: string | null; head: string | null };
}

export interface Decision {
  run: boolean;
  /** In pt-BR: it shows in the job log and summary. */
  reason: string;
}

/** Whether the browser jobs run for these changes. */
export function decide(changes: readonly Change[], rootPackageOnBase: () => string | null): Decision {
  if (changes.length === 0) return { run: true, reason: "nenhum arquivo alterado encontrado" };
  let versionFiles: string[] | undefined;
  let workspaces: string[] = [];
  const needing: string[] = [];
  let versions = 0;
  for (const change of changes) {
    if (isTextOnly(change.path)) continue;
    if (!versionFiles) {
      // From the base branch: the pull request cannot name its own files.
      workspaces = workspacesOf(rootPackageOnBase() ?? "{}");
      versionFiles = versionFilesOf(workspaces);
    }
    const { base, head } = versionFiles.includes(change.path) ? change.read() : { base: null, head: null };
    if (base !== null && head !== null && onlyVersionChanged(change.path, base, head, workspaces)) versions++;
    else needing.push(change.path);
  }
  if (needing.length > 0) {
    const shown = needing.slice(0, 10).map((path) => `\`${path.replace(/[`@\r\n]/g, "_")}\``);
    const more = needing.length > shown.length ? ` e mais ${needing.length - shown.length}` : "";
    return { run: true, reason: `a PR muda ${shown.join(", ")}${more}` };
  }
  const what = versions > 0 ? "só texto e o número da versão" : "só texto (documentação, changelog, memória do agente)";
  return { run: false, reason: `a PR muda ${what}; nada que o navegador abra mudou` };
}

type Exec = (args: string[]) => string;
// stderr is kept out of the log: a file missing on one side is an answer here, not an error.
const git: Exec = (args) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 256 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"] });

/** The branches whose pull requests may skip the browsers: the ones the rulesets protect. */
export const SKIPPABLE_BASES: readonly string[] = ["develop", "main"];
/** A plain file: not a symlink, not executable, not a submodule. */
const PLAIN_FILE = "100644";

/**
 * Reads the pull request from the merge commit actions/checkout leaves in HEAD
 * (fetch-depth 2): the first parent is the base branch, so the diff between
 * the two is exactly what the merge would bring.
 */
export function decideFromCheckout(eventName: string, baseRef: string, exec: Exec = git): Decision {
  if (eventName !== "pull_request") return { run: true, reason: `evento ${eventName || "desconhecido"}: sempre roda` };
  // The check stays on the head commit when the base of a pull request is changed, and that starts no new run:
  // a text-only pull request into a branch full of unmerged code would bring its green result to develop.
  if (!SKIPPABLE_BASES.includes(baseRef)) return { run: true, reason: `a base da PR é ${baseRef ? "outra branch" : "desconhecida"}: sempre roda` };
  try {
    const parents = exec(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(/\s+/).slice(1);
    if (parents.length !== 2) return { run: true, reason: "HEAD não é o commit de merge da PR" };
    const show = (ref: string, path: string) => {
      try {
        return exec(["show", `${ref}:${path}`]);
      } catch {
        return null;
      }
    };
    // --no-renames: a file moved out of the code shows as a removal there, not as a new text file.
    // --raw: the modes too, so a version file turned into a symlink or made executable is not "only the number".
    const fields = exec(["diff", "--raw", "--no-renames", "--no-abbrev", "-z", "HEAD^1", "HEAD"]).split("\0").filter(Boolean);
    const changes: Change[] = [];
    for (let i = 0; i + 1 < fields.length; i += 2) {
      const [before, after] = (fields[i] as string).slice(1).split(" ");
      const path = fields[i + 1] as string;
      const plain = before === PLAIN_FILE && after === PLAIN_FILE;
      changes.push({ path, read: () => (plain ? { base: show("HEAD^1", path), head: show("HEAD", path) } : { base: null, head: null }) });
    }
    if (fields.length % 2 !== 0) return { run: true, reason: "lista de arquivos alterados incompleta" };
    return decide(changes, () => show("HEAD^1", "package.json"));
  } catch (error) {
    return { run: true, reason: `não deu para ler as mudanças (${error instanceof Error ? error.message.split("\n")[0] : "erro"})` };
  }
}

if (import.meta.main) {
  const decision = decideFromCheckout(process.env.EVENT_NAME ?? "", process.env.BASE_REF ?? "");
  const text = decision.run
    ? `Os testes no navegador rodam: ${decision.reason}.`
    : `Os testes no navegador não rodam: ${decision.reason}. Os outros checks continuam valendo.`;
  console.log(text);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${text}\n`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${decision.run}\n`);
}
