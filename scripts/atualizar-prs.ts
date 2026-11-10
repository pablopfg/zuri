// Brings develop into the open pull requests and resolves the conflicts that
// are only two additions at the same place (two changelog entries, two README
// rows, two catalog keys). Anything else is left for a person or a thread:
// the pull request gets one comment that names the files.
//
// Two modes:
//   node scripts/atualizar-prs.ts           every open PR into develop (GitHub Actions, update-prs.yml)
//   node scripts/atualizar-prs.ts --local   merges origin/develop into the current branch (threads, by hand)
//
// After its own push it approves the pull_request runs GitHub holds for the
// bot (approveHeldRuns). It never merges a pull request, never force-pushes
// and never pushes to develop or main. See docs/agente/merge-de-prs.md.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BASE_BRANCH = "develop";
export const PROTECTED_BRANCHES = ["develop", "main"];
/** A pull request with this label is never touched by the automatic update. */
export const OPT_OUT_LABEL = "sem-atualizacao-automatica";
/** Hidden marker of the one comment the workflow keeps on each pull request. */
export const NOTICE_MARKER = "<!-- zuri:atualizar-prs -->";
/**
 * The pull_request workflows that report the required checks, by file and by
 * run name. A push made with GITHUB_TOKEN starts them held for approval
 * ("action_required"), and this script approves the ones its own push started.
 */
export const PR_WORKFLOWS: Record<string, string> = { "ci.yml": "CI", "codeql.yml": "CodeQL", "merge-order.yml": "Merge order" };
/** The account that pushes with GITHUB_TOKEN. */
export const BOT_LOGIN = "github-actions[bot]";

/**
 * Files where two additions at the same place can simply be kept together:
 * lists of entries, tables, catalogs of keys. Code with logic is not here, and
 * the CI still runs on the result (a repeated key fails the typecheck).
 */
const ADDITIVE_FILES = [
  /^CHANGELOG\.md$/,
  /^README\.md$/,
  /^changelog\/[^/]+\/[^/]+\.md$/,
  /^\.claude\/memoria\/[^/]+\.md$/,
  /^docs\/.+\.md$/,
  /^packages\/shared\/i18n\/(?:pt-BR[\w-]*|en)\.ts$/,
];

export function isAdditiveFile(path: string): boolean {
  return ADDITIVE_FILES.some((pattern) => pattern.test(path));
}

export interface Resolution {
  /** True when every conflict in the text was two additions and is now resolved. */
  resolved: boolean;
  text: string;
  conflicts: number;
}

const OURS = /^<{7}(?: .*)?$/;
const BASE = /^\|{7}(?: .*)?$/;
const SPLIT = /^={7}$/;
const THEIRS = /^>{7}(?: .*)?$/;
const LEFTOVER_MARKER = /^(?:<{7,}|>{7,}|\|{7,})(?: |$)/m;

/**
 * Resolves conflict hunks written in diff3 style (merge.conflictStyle=diff3)
 * when the common ancestor is empty, that is, both sides only added lines at
 * the same place. Keeps the base branch's lines ("theirs" when develop is
 * merged into the PR) first and the PR's lines after; identical additions are
 * kept once. A hunk that changed or removed an existing line, or markers it
 * cannot read, leave the whole text unresolved.
 */
export function resolveAdditiveConflicts(text: string): Resolution {
  const lines = text.split("\n");
  const out: string[] = [];
  let conflicts = 0;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (!OURS.test(line)) {
      if (BASE.test(line) || SPLIT.test(line) || THEIRS.test(line)) return { resolved: false, text, conflicts };
      out.push(line);
      i++;
      continue;
    }
    conflicts++;
    const ours: string[] = [];
    const base: string[] = [];
    const theirs: string[] = [];
    let section: string[] | null = ours;
    let sawBase = false;
    let closed = false;
    i++;
    for (; i < lines.length; i++) {
      const current = lines[i] as string;
      if (OURS.test(current)) return { resolved: false, text, conflicts };
      if (BASE.test(current) && section === ours) {
        section = base;
        sawBase = true;
      } else if (SPLIT.test(current) && (section === base || section === ours)) {
        section = theirs;
      } else if (THEIRS.test(current) && section === theirs) {
        closed = true;
        i++;
        break;
      } else if (BASE.test(current) || SPLIT.test(current) || THEIRS.test(current)) {
        return { resolved: false, text, conflicts };
      } else {
        section.push(current);
      }
    }
    // Without the ancestor (no diff3) there is no way to know that nothing was removed.
    if (!closed || !sawBase || base.length > 0) return { resolved: false, text, conflicts };
    if (ours.join("\n") === theirs.join("\n")) {
      out.push(...theirs);
      continue;
    }
    // A line on both sides (a cherry-picked entry, say) would come out twice: leave it to a person.
    const theirLines = new Set(theirs.filter((l) => l.trim()));
    if (ours.some((l) => l.trim() && theirLines.has(l))) return { resolved: false, text, conflicts };
    out.push(...theirs, ...ours);
  }
  const resolvedText = out.join("\n");
  // Longer markers (conflict-marker-size) are not parsed above: never hand them back as resolved.
  if (conflicts === 0 || LEFTOVER_MARKER.test(resolvedText)) return { resolved: false, text, conflicts };
  return { resolved: true, text: resolvedText, conflicts };
}

// --- git ------------------------------------------------------------------

export type Run = (cmd: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }) => string;

export const run: Run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });

export const tryRun = (fn: () => string): { ok: true; out: string } | { ok: false; out: string } => {
  try {
    return { ok: true, out: fn() };
  } catch (error) {
    const e = error as { stdout?: string; stderr?: string };
    return { ok: false, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
};

export type MergeOutcome =
  | { status: "up-to-date" }
  | { status: "merged"; resolved: string[] }
  | { status: "conflict"; files: string[] };

export const MERGE_MESSAGE = `chore: traz a ${BASE_BRANCH} para a branch (automático)`;

/**
 * Merges `baseRef` into the branch checked out in `dir` with a merge commit
 * (never a rebase: the branch keeps its history and nobody needs to force-push).
 * Resolves the additive conflicts in the files of `isAdditiveFile`; with any
 * other conflict the merge is aborted and the files are returned.
 */
export function mergeBase(dir: string, baseRef: string, exec: Run = run): MergeOutcome {
  const git = (...args: string[]) => exec("git", args, { cwd: dir });
  if (tryRun(() => git("merge-base", "--is-ancestor", baseRef, "HEAD")).ok) return { status: "up-to-date" };

  const merge = tryRun(() =>
    git("-c", "merge.conflictStyle=diff3", "merge", "--no-ff", "--no-edit", "-m", MERGE_MESSAGE, baseRef),
  );
  if (merge.ok) return { status: "merged", resolved: [] };

  const unmerged = git("diff", "--name-only", "--diff-filter=U", "-z")
    .split("\0")
    .filter(Boolean);
  if (unmerged.length === 0) {
    // The merge failed for another reason (for example, a dirty work tree).
    tryRun(() => git("merge", "--abort"));
    throw new Error(`git merge failed: ${merge.out.trim()}`);
  }

  const remaining: string[] = [];
  const resolved: string[] = [];
  for (const file of unmerged) {
    if (!isAdditiveFile(file)) {
      remaining.push(file);
      continue;
    }
    // Only a conflict where both sides kept the file has all three stages;
    // a deleted or renamed side is left for a person.
    // Regular files only: a symlink would make the write land somewhere else.
    const stages = git("ls-files", "-u", "-s", "--", file).trim().split("\n");
    if (stages.length !== 3 || !stages.every((stage) => /^100(644|755) /.test(stage))) {
      remaining.push(file);
      continue;
    }
    const path = join(dir, file);
    const result = resolveAdditiveConflicts(readFileSync(path, "utf8"));
    if (!result.resolved) {
      remaining.push(file);
      continue;
    }
    writeFileSync(path, result.text);
    git("add", "--", file);
    resolved.push(file);
  }

  if (remaining.length > 0) {
    git("merge", "--abort");
    return { status: "conflict", files: remaining.sort() };
  }
  git("commit", "--no-edit", "-m", `${MERGE_MESSAGE}\n\nConflitos de acréscimo resolvidos em: ${resolved.join(", ")}`);
  return { status: "merged", resolved: resolved.sort() };
}

// --- GitHub ---------------------------------------------------------------

export interface PullRequest {
  number: number;
  draft: boolean;
  head: { ref: string; sha: string; repo: { full_name: string } | null };
  base: { ref: string };
  labels: { name: string }[];
}

/** Why a pull request is left alone, or null when the workflow may update it. */
export function skipReason(pr: PullRequest, repository: string): string | null {
  if (pr.base.ref !== BASE_BRANCH) return `base is ${pr.base.ref}`;
  if (pr.head.repo?.full_name !== repository) return "branch from a fork";
  if (PROTECTED_BRANCHES.includes(pr.head.ref)) return "protected branch";
  if (pr.draft) return "draft";
  if (pr.labels.some((label) => label.name === OPT_OUT_LABEL)) return `label ${OPT_OUT_LABEL}`;
  return null;
}

/** True for the branch names git accepts; anything else is never fetched or pushed. */
export function isSafeBranchName(name: string, exec: Run = run): boolean {
  if (!/^[\w./-]+$/.test(name) || name.startsWith("-")) return false;
  return tryRun(() => exec("git", ["check-ref-format", "--branch", name])).ok;
}

export type Notice =
  | { kind: "conflict"; files: string[] }
  | { kind: "workflows" }
  | { kind: "resolved"; files: string[] }
  | { kind: "push-failed" }
  | { kind: "approval"; runs: string[] }
  | { kind: "clear" };

/** The text of the one comment the workflow keeps on a pull request, in pt-BR. */
export function noticeBody(notice: Notice, baseSha: string): string {
  const head = `${NOTICE_MARKER}\n`;
  const at = `\`${BASE_BRANCH}\` em \`${baseSha.slice(0, 7)}\``;
  // File names come from the branch: no backtick or @ that could break the list or mention someone.
  const list = (files: string[]) => files.map((file) => `- \`${file.replace(/[`@\r\n]/g, "_")}\``).join("\n");
  switch (notice.kind) {
    case "conflict":
      return `${head}**Conflito com a ${BASE_BRANCH} que precisa de uma pessoa.** A atualização automática (${at}) parou nestes arquivos:\n\n${list(notice.files)}\n\nTraga a \`${BASE_BRANCH}\` para a branch, resolva preservando os dois lados e rode as verificações (\`docs/agente/merge-de-prs.md\`). Os conflitos de acréscimo, como duas entradas de changelog, saem sozinhos com \`node scripts/atualizar-prs.ts --local\`.`;
    case "workflows":
      return `${head}**Atualização automática não enviada.** A ${BASE_BRANCH} (${at}) muda arquivos de \`.github/workflows/\`, e o token do GitHub Actions não pode enviá-los. Atualize pelo botão "Update branch" ou com \`node scripts/atualizar-prs.ts --local\`.`;
    case "resolved":
      return `${head}Branch atualizada com a ${BASE_BRANCH} (${at}). Conflitos de acréscimo resolvidos sozinhos, mantendo os dois lados:\n\n${list(notice.files)}\n\nConfira se a ordem das entradas ficou boa. A CI roda de novo neste commit.`;
    case "push-failed":
      return `${head}**Atualização automática recusada pelo GitHub** (${at}). A branch não mudou, mas o envio foi recusado (permissão ou regra). Veja o log do workflow "Update PRs" e atualize com \`node scripts/atualizar-prs.ts --local\`.`;
    case "approval":
      return `${head}**A CI deste commit está parada esperando aprovação** (${at}). A atualização automática enviou o commit, mas não conseguiu aprovar as execuções que o GitHub segura para o bot: ${notice.runs.map((r) => `\`${r.replace(/[`@\r\n]/g, "_")}\``).join(", ")}. Aprove em Actions, na execução, com "Approve and run" (\`docs/configuracao-github.md\`).`;
    case "clear":
      return `${head}Branch em dia com a ${BASE_BRANCH} (${at}), sem conflito pendente.`;
  }
}

export interface GitHub {
  repository: string;
  baseSha: string;
  exec: Run;
}

const gh = (ctx: GitHub, args: string[]) => ctx.exec("gh", args);

function openPullRequests(ctx: GitHub): PullRequest[] {
  const out = gh(ctx, ["api", "--paginate", "--slurp", `repos/${ctx.repository}/pulls?state=open&base=${BASE_BRANCH}&per_page=100`]);
  return (JSON.parse(out) as PullRequest[][]).flat();
}

function existingNotice(ctx: GitHub, pr: number): { id: number; body: string } | null {
  const out = gh(ctx, ["api", "--paginate", "--slurp", `repos/${ctx.repository}/issues/${pr}/comments?per_page=100`]);
  const comments = (JSON.parse(out) as { id: number; body: string; user: { login: string } }[][]).flat();
  return comments.find((c) => c.user.login === "github-actions[bot]" && c.body.startsWith(NOTICE_MARKER)) ?? null;
}

/** Keeps one comment per pull request: created once, edited afterwards (edits notify nobody). */
export function notify(ctx: GitHub, pr: number, notice: Notice): void {
  const existing = existingNotice(ctx, pr);
  if (notice.kind === "clear" && !existing) return;
  const body = noticeBody(notice, ctx.baseSha);
  if (existing) {
    if (existing.body === body) return;
    gh(ctx, ["api", "-X", "PATCH", `repos/${ctx.repository}/issues/comments/${existing.id}`, "-f", `body=${body}`]);
  } else {
    gh(ctx, ["api", "-X", "POST", `repos/${ctx.repository}/issues/${pr}/comments`, "-f", `body=${body}`]);
  }
}

export interface WorkflowRun {
  id: number;
  name: string;
  event: string;
  status: string;
  conclusion: string | null;
  head_sha: string;
  created_at: string;
  actor: { login: string } | null;
  head_repository: { full_name: string } | null;
}

/** The pull_request runs on `sha`, from this repository (never a fork). */
export function pullRequestRuns(ctx: Pick<GitHub, "repository" | "exec">, sha: string): WorkflowRun[] {
  const out = ctx.exec("gh", [
    "api",
    `repos/${ctx.repository}/actions/runs?head_sha=${sha}&event=pull_request&per_page=100`,
  ]);
  const runs = (JSON.parse(out) as { workflow_runs: WorkflowRun[] }).workflow_runs;
  return runs.filter((r) => r.event === "pull_request" && r.head_sha === sha && r.head_repository?.full_name === ctx.repository);
}

/**
 * The runs of `sha` to approve. The listing by commit comes from GitHub's
 * search and can leave a run out long after it exists (issue #253: the CI run,
 * held from the second of the push, was still not listed 36 minutes later, so
 * nobody approved it). A required workflow with no run there is read again
 * from that workflow's own newest runs, which does not go through the search.
 * That list is the same for every commit: `own` keeps it, by workflow file,
 * for the callers that read several commits in a row.
 */
export function commitRuns(ctx: Pick<GitHub, "repository" | "exec">, sha: string, own = new Map<string, WorkflowRun[]>()): WorkflowRun[] {
  const runs = pullRequestRuns(ctx, sha);
  for (const [file, name] of Object.entries(PR_WORKFLOWS)) {
    if (runs.some((r) => r.name === name)) continue;
    let newest = own.get(file);
    if (!newest) {
      // A failed or odd answer here only leaves the workflow missing, as before: the next read may answer.
      const read = tryRun(() => {
        const out = ctx.exec("gh", ["api", `repos/${ctx.repository}/actions/workflows/${file}/runs?per_page=100`]);
        return JSON.stringify((JSON.parse(out) as { workflow_runs?: WorkflowRun[] }).workflow_runs ?? []);
      });
      if (!read.ok) continue;
      newest = JSON.parse(read.out) as WorkflowRun[];
      own.set(file, newest);
    }
    runs.push(...newest.filter((r) => r.name === name && r.event === "pull_request" && r.head_sha === sha && r.head_repository?.full_name === ctx.repository));
  }
  return runs;
}

/** Runs GitHub holds for approval because this workflow's push (the bot) started them. */
export const isHeldForBot = (run: WorkflowRun) => run.conclusion === "action_required" && run.actor?.login === BOT_LOGIN;

export interface Approval {
  approved: string[];
  failed: string[];
  /** What GitHub answered for each run left in `failed`, so the run log says why. */
  errors: string[];
  /** Required workflows with no run on the commit after waiting. */
  missing: string[];
}

export const sleepMs = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/**
 * A push made with GITHUB_TOKEN starts the pull_request runs held as
 * "action_required": GitHub treats github-actions[bot] as a contributor whose
 * runs need approval. The ruleset counts only the checks of those runs (a
 * workflow_dispatch run on the branch left the merge "expected" on #60), so
 * the workflow approves the runs its own push started, on its own branch,
 * never a fork's. GitHub creates the runs a few seconds after the push, and
 * sometimes takes more than 40 s (issue #201): `attempts` reads, `waitMs`
 * apart (2 minutes in all), until every required workflow has one.
 */
export function approveHeldRuns(
  ctx: Pick<GitHub, "repository" | "exec">,
  sha: string,
  { attempts = 12, waitMs = 10_000, sleep = sleepMs }: { attempts?: number; waitMs?: number; sleep?: (ms: number) => unknown } = {},
): Approval {
  let runs: WorkflowRun[] = [];
  for (let i = 0; i < attempts; i++) {
    if (i > 0) sleep(waitMs);
    runs = commitRuns(ctx, sha);
    if (missingWorkflows(runs).length === 0) break;
  }
  return approveFound(ctx, sha, runs, { waitMs, sleep });
}

/** Names of the required workflows with no run among `runs`. */
const missingWorkflows = (runs: WorkflowRun[]) =>
  Object.values(PR_WORKFLOWS).filter((name) => !runs.some((r) => r.name === name));

/** Approves the held runs among `runs`, the runs read for `sha`. */
function approveFound(
  ctx: Pick<GitHub, "repository" | "exec">,
  sha: string,
  runs: WorkflowRun[],
  { waitMs, sleep }: { waitMs: number; sleep: (ms: number) => unknown },
): Approval {
  const result: Approval = { approved: [], failed: [], errors: [], missing: missingWorkflows(runs) };
  for (const run of runs.filter(isHeldForBot)) {
    const done = approveRun(ctx, sha, run.id, { waitMs, sleep });
    if (done.ok) {
      result.approved.push(run.name);
    } else {
      result.failed.push(run.name);
      result.errors.push(`${run.name}: ${done.out.trim().split("\n").at(-1) || "no answer"}`);
    }
  }
  return result;
}

/** A pushed commit whose runs GitHub had not created yet when its pull request was handled. */
export interface LateCommit {
  sha: string;
  /** When the push went through (ms since the epoch). */
  pushedAt: number;
  /** What the first round already approved. */
  approved: string[];
}

/** Between approval retries in the late round: short, so the approvals fit the job's timeout. */
export const LATE_APPROVE_RETRY_MS = 3_000;

/** How long after a push GitHub may still create its runs: 9 minutes on #208 (issue #210). */
export const LATE_RUNS_MS = 15 * 60_000;

/**
 * The second chance for the commits of `late`. GitHub sometimes creates the
 * pull_request runs of a bot push many minutes after it (issue #210: 9 minutes,
 * long after the 2 minutes of approveHeldRuns), and a run left held keeps the
 * pull request from ever merging. So once every pull request had its turn, the
 * commits still missing runs are read again, `waitMs` apart (20 s, so a few
 * late commits stay far from the API's hourly limit), all in the same
 * loop, until each has every required run (and its held ones are approved) or
 * `LATE_RUNS_MS` passed since its push, never past `deadline`, which keeps the
 * job inside its timeout. Results come in the order of `late`.
 */
export function approveLateRuns(
  ctx: Pick<GitHub, "repository" | "exec">,
  late: LateCommit[],
  {
    deadline,
    waitMs = 20_000,
    lateMs = LATE_RUNS_MS,
    now = Date.now,
    sleep = sleepMs,
  }: { deadline: number; waitMs?: number; lateMs?: number; now?: () => number; sleep?: (ms: number) => unknown },
): Approval[] {
  const results: (Approval | undefined)[] = late.map(() => undefined);
  const lastRuns: WorkflowRun[][] = late.map(() => []);
  for (;;) {
    // Each workflow's own runs are read at most once per round, whatever the number of commits (hourly API limit).
    const own = new Map<string, WorkflowRun[]>();
    for (const [i, commit] of late.entries()) {
      if (results[i]) continue;
      const read = tryRun(() => JSON.stringify(commitRuns(ctx, commit.sha, own)));
      // A failed read leaves the last list in place: the next read may answer.
      if (read.ok) lastRuns[i] = JSON.parse(read.out) as WorkflowRun[];
      const runs = lastRuns[i] ?? [];
      const complete = missingWorkflows(runs).length === 0;
      if (complete || now() >= Math.min(commit.pushedAt + lateMs, deadline)) {
        const approval = approveFound(ctx, commit.sha, runs, { waitMs: LATE_APPROVE_RETRY_MS, sleep });
        // A run approved in the first round may still read as held for a moment: name it once.
        results[i] = { ...approval, approved: [...new Set([...commit.approved, ...approval.approved])] };
      }
    }
    if (results.every(Boolean)) return results as Approval[];
    sleep(waitMs);
  }
}

/** Approval calls per run before it counts as failed. */
export const APPROVE_ATTEMPTS = 3;

/**
 * One approval, retried. GitHub sometimes answers an error for an approval it
 * took (issues #166 and #190: the run started anyway) or refuses one that goes
 * through a moment later (issue #201), so before each retry and after the last
 * error the run is read again: once it left "action_required", it was approved.
 */
function approveRun(
  ctx: Pick<GitHub, "repository" | "exec">,
  sha: string,
  id: number,
  { waitMs, sleep }: { waitMs: number; sleep: (ms: number) => unknown },
): { ok: boolean; out: string } {
  const held = () => {
    const now = tryRun(() => JSON.stringify(commitRuns(ctx, sha).find((r) => r.id === id) ?? null));
    // A failed read proves nothing: the run still counts as held.
    if (!now.ok) return true;
    const found = JSON.parse(now.out) as WorkflowRun | null;
    return found !== null && found.conclusion === "action_required";
  };
  let out = "";
  for (let i = 0; i < APPROVE_ATTEMPTS; i++) {
    if (i > 0) {
      sleep(waitMs);
      if (!held()) return { ok: true, out: "" };
    }
    const done = tryRun(() => ctx.exec("gh", ["api", "-X", "POST", `repos/${ctx.repository}/actions/runs/${id}/approve`]));
    if (done.ok) return done;
    out = done.out;
  }
  sleep(waitMs);
  return held() ? { ok: false, out } : { ok: true, out: "" };
}

/** Git config for one authenticated command, through the environment so the token never shows in argv. */
export function authEnv(token: string): NodeJS.ProcessEnv {
  const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
  return {
    ...process.env,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
  };
}

/**
 * How long a round may keep waiting for late runs: the update job stops at
 * 20 minutes (timeout-minutes in update-prs.yml), and checkout, setup and the
 * merge-order refresh after this script need the rest, as do the approvals
 * of the late round (each retried for up to about 12 s).
 */
export const RUN_BUDGET_MS = 12 * 60_000;

/** Reads of the first wait for each pushed commit (20 s), before the late round. */
export const FIRST_ATTEMPTS = 3;

function updateAll(root: string): number {
  const deadline = Date.now() + RUN_BUDGET_MS;
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN;
  if (!repository || !token) throw new Error("GITHUB_REPOSITORY and GH_TOKEN are required");
  // The token goes only to the commands that talk to GitHub; the merge runs without it.
  const auth = authEnv(token);
  const remote = (args: string[], cwd = root) => run("git", args, { cwd, env: auth });
  const git = (args: string[], cwd = root) => run("git", args, { cwd });

  remote(["fetch", "--no-tags", "origin", `+refs/heads/${BASE_BRANCH}:refs/remotes/origin/${BASE_BRANCH}`]);
  const baseSha = git(["rev-parse", `origin/${BASE_BRANCH}`]).trim();
  const ctx: GitHub = { repository, baseSha, exec: run };
  let failures = 0;
  const late: { number: number; label: string; resolved: string[]; commit: LateCommit }[] = [];

  /** Comments on the pull request; false when its checks are stuck waiting for approval. */
  const reportApproval = (label: string, number: number, approval: Approval, resolved: string[]) => {
    // Without the pull_request runs the required checks never report: someone has to approve them.
    const stuck = [...approval.failed, ...approval.missing];
    if (stuck.length > 0) {
      console.log(`${label}: checks waiting: ${stuck.join(", ")}${approval.errors.length ? ` (${approval.errors.join("; ")})` : ""}`);
      notify(ctx, number, { kind: "approval", runs: stuck });
      return false;
    }
    notify(ctx, number, resolved.length ? { kind: "resolved", files: resolved } : { kind: "clear" });
    return true;
  };

  for (const pr of openPullRequests(ctx)) {
    const label = `#${pr.number}`;
    const skip = skipReason(pr, repository);
    if (skip) {
      console.log(`${label}: skipped (${skip})`);
      continue;
    }
    const ref = pr.head.ref;
    if (!isSafeBranchName(ref)) {
      console.log(`${label}: skipped (branch name)`);
      continue;
    }
    const dir = mkdtempSync(join(tmpdir(), "pr-"));
    // One pull request failing never stops the others; the run ends red so someone sees it.
    try {
      remote(["fetch", "--no-tags", "origin", `+refs/heads/${ref}:refs/remotes/origin/${ref}`]);
      const before = git(["rev-parse", `refs/remotes/origin/${ref}`]).trim();
      git(["worktree", "add", "--detach", dir, before]);
      const outcome = mergeBase(dir, `refs/remotes/origin/${BASE_BRANCH}`);
      if (outcome.status === "up-to-date") {
        // Its own merge from an earlier round may still have runs held (approval failed then).
        if (git(["log", "-1", "--format=%s", before]).startsWith(MERGE_MESSAGE)) {
          const approval = approveHeldRuns(ctx, before, { attempts: 1 });
          if (approval.failed.length > 0) {
            console.log(`${label}: up to date, approval failed for ${approval.errors.join("; ")}`);
            notify(ctx, pr.number, { kind: "approval", runs: approval.failed });
            failures++;
            continue;
          }
          console.log(`${label}: up to date${approval.approved.length ? `, approved ${approval.approved.join(", ")}` : ""}`);
        } else {
          console.log(`${label}: up to date`);
        }
        notify(ctx, pr.number, { kind: "clear" });
        continue;
      }
      if (outcome.status === "conflict") {
        console.log(`${label}: conflict in ${outcome.files.join(", ")}`);
        notify(ctx, pr.number, { kind: "conflict", files: outcome.files });
        continue;
      }
      if (git(["diff", "--name-only", before, "HEAD", "--", ".github/workflows"], dir).trim()) {
        console.log(`${label}: develop changes workflows, not pushed`);
        notify(ctx, pr.number, { kind: "workflows" });
        continue;
      }
      // A plain push, never forced: if the branch moved meanwhile it is refused, and the next run tries again.
      const push = tryRun(() => remote(["push", "origin", `HEAD:refs/heads/${ref}`], dir));
      if (!push.ok) {
        const now = remote(["ls-remote", "origin", `refs/heads/${ref}`]).split("\t")[0]?.trim();
        if (now && now !== before) {
          console.log(`${label}: branch moved during the update; next run tries again`);
        } else {
          console.log(`${label}: push refused: ${push.out.trim()}`);
          notify(ctx, pr.number, { kind: "push-failed" });
          failures++;
        }
        continue;
      }
      const pushedAt = Date.now();
      const sha = git(["rev-parse", "HEAD"], dir).trim();
      // Short first wait: the late round below waits for every pull request at once.
      const approval = approveHeldRuns(ctx, sha, { attempts: Date.now() < deadline ? FIRST_ATTEMPTS : 1 });
      const updated = `${label}: updated${outcome.resolved.length ? `, resolved ${outcome.resolved.join(", ")}` : ""}`;
      // Runs GitHub has not created yet get a second chance once every pull request had its turn.
      // A refused approval among them is retried there too, since its run is still held.
      if (approval.missing.length > 0) {
        console.log(`${updated}; approved ${approval.approved.join(", ") || "none"}; not created yet: ${approval.missing.join(", ")}`);
        late.push({ number: pr.number, label, resolved: outcome.resolved, commit: { sha, pushedAt, approved: approval.approved } });
        continue;
      }
      console.log(`${updated}; approved ${approval.approved.join(", ") || "none"}`);
      if (!reportApproval(label, pr.number, approval, outcome.resolved)) failures++;
    } catch (error) {
      failures++;
      console.log(`${label}: failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      tryRun(() => git(["worktree", "remove", "--force", dir]));
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (late.length > 0) {
    const approvals = approveLateRuns(
      ctx,
      late.map((l) => l.commit),
      { deadline },
    );
    for (const [i, l] of late.entries()) {
      const approval = approvals[i] as Approval;
      try {
        console.log(`${l.label}: late runs; approved ${approval.approved.join(", ") || "none"}`);
        if (!reportApproval(l.label, l.number, approval, l.resolved)) failures++;
      } catch (error) {
        failures++;
        console.log(`${l.label}: failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
  return failures > 0 ? 1 : 0;
}

function updateLocal(root: string): number {
  const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root }).trim();
  if (PROTECTED_BRANCHES.includes(branch)) {
    console.error(`atualizar-prs: you are on ${branch}; switch to the PR branch first`);
    return 1;
  }
  if (run("git", ["status", "--porcelain", "--untracked-files=no"], { cwd: root }).trim()) {
    console.error("atualizar-prs: commit or stash your changes first (an aborted merge could lose them)");
    return 1;
  }
  run("git", ["fetch", "--no-tags", "origin", BASE_BRANCH], { cwd: root });
  const outcome = mergeBase(root, `origin/${BASE_BRANCH}`);
  if (outcome.status === "conflict") {
    console.error(`atualizar-prs: resolve by hand (merge aborted): ${outcome.files.join(", ")}`);
    return 1;
  }
  if (outcome.status === "up-to-date") console.log(`atualizar-prs: ${branch} already has ${BASE_BRANCH}`);
  else console.log(`atualizar-prs: merged ${BASE_BRANCH}; additive conflicts resolved: ${outcome.resolved.join(", ") || "none"}`);
  console.log("Run typecheck, lint and the tests of the touched areas before pushing.");
  return 0;
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..");
  if (process.argv.includes("--local")) process.exit(updateLocal(root));
  process.exit(updateAll(root));
}
