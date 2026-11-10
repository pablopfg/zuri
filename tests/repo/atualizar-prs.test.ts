import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type GitHub,
  isAdditiveFile,
  isSafeBranchName,
  MERGE_MESSAGE,
  mergeBase,
  APPROVE_ATTEMPTS,
  approveHeldRuns,
  approveLateRuns,
  LATE_APPROVE_RETRY_MS,
  LATE_RUNS_MS,
  RUN_BUDGET_MS,
  PR_WORKFLOWS,
  type WorkflowRun,
  notify,
  NOTICE_MARKER,
  noticeBody,
  OPT_OUT_LABEL,
  type PullRequest,
  resolveAdditiveConflicts,
  skipReason,
} from "../../scripts/atualizar-prs.ts";

const hunk = (ours: string[], base: string[], theirs: string[]) =>
  ["<<<<<<< HEAD", ...ours, "||||||| merged common ancestors", ...base, "=======", ...theirs, ">>>>>>> develop"].join("\n");

describe("resolveAdditiveConflicts", () => {
  it("keeps both additions, develop's first", () => {
    const text = ["# Changelog", hunk(["- PR entry"], [], ["- develop entry"]), "- old"].join("\n");
    const result = resolveAdditiveConflicts(text);
    expect(result).toEqual({ resolved: true, conflicts: 1, text: "# Changelog\n- develop entry\n- PR entry\n- old" });
  });

  it("keeps identical additions once", () => {
    expect(resolveAdditiveConflicts(hunk(["a"], [], ["a"])).text).toBe("a");
  });

  it("resolves several hunks in one file", () => {
    const text = [hunk(["1"], [], ["2"]), "mid", hunk(["3"], [], ["4"])].join("\n");
    expect(resolveAdditiveConflicts(text)).toEqual({ resolved: true, conflicts: 2, text: "2\n1\nmid\n4\n3" });
  });

  it("refuses a hunk that changed an existing line", () => {
    const text = hunk(["new row A"], ["row A"], ["row A, edited"]);
    expect(resolveAdditiveConflicts(text)).toMatchObject({ resolved: false, text });
  });

  it("refuses a hunk where one side removed a line", () => {
    expect(resolveAdditiveConflicts(hunk([], ["gone"], ["gone", "added"])).resolved).toBe(false);
  });

  it("refuses additions that share a line, which would come out twice", () => {
    expect(resolveAdditiveConflicts(hunk(["- x", "- y"], [], ["- x"])).resolved).toBe(false);
    // Blank lines on both sides are fine.
    expect(resolveAdditiveConflicts(hunk(["- y", ""], [], ["- x", ""])).text).toBe("- x\n\n- y\n");
  });

  it("does not resolve CRLF markers", () => {
    const crlf = hunk(["a"], [], ["b"]).replace(/\n/g, "\r\n");
    expect(resolveAdditiveConflicts(crlf).resolved).toBe(false);
  });

  it("refuses the merge style without the ancestor", () => {
    const text = ["<<<<<<< HEAD", "a", "=======", "b", ">>>>>>> develop"].join("\n");
    expect(resolveAdditiveConflicts(text).resolved).toBe(false);
  });

  it("refuses broken or nested markers", () => {
    expect(resolveAdditiveConflicts(["<<<<<<< HEAD", "a", "||||||| base", "=======", "b"].join("\n")).resolved).toBe(false);
    expect(resolveAdditiveConflicts(["<<<<<<< HEAD", "<<<<<<< x", "||||||| b", "=======", ">>>>>>> y"].join("\n")).resolved).toBe(
      false,
    );
    expect(resolveAdditiveConflicts(["text", "=======", "more"].join("\n")).resolved).toBe(false);
    expect(resolveAdditiveConflicts(["<<<<<<< HEAD", "a", "=======", "||||||| b", ">>>>>>> d"].join("\n")).resolved).toBe(false);
  });

  it("never reports a text without conflicts, or with longer markers, as resolved", () => {
    expect(resolveAdditiveConflicts("plain\ntext").resolved).toBe(false);
    const long = ["<<<<<<<< HEAD", "a", "|||||||| base", "========", "b", ">>>>>>>> develop"].join("\n");
    expect(resolveAdditiveConflicts(`${hunk(["x"], [], ["y"])}\n${long}`).resolved).toBe(false);
  });
});

describe("isAdditiveFile", () => {
  it.each([
    "CHANGELOG.md",
    "README.md",
    "changelog/nao-lancado/etapa-10.md",
    ".claude/memoria/decisoes.md",
    "docs/agente/merge-de-prs.md",
    "packages/shared/i18n/en.ts",
    "packages/shared/i18n/pt-BR-settings.ts",
  ])("accepts %s", (path) => expect(isAdditiveFile(path)).toBe(true));

  it.each([
    "apps/agent/src/api/app.ts",
    "packages/shared/src/index.ts",
    "package-lock.json",
    "apps/agent/migrations/0009.sql",
    ".github/workflows/ci.yml",
    "docs/capturas/inicio.png",
    "sub/CHANGELOG.md",
    "packages/shared/i18n/index.ts",
  ])("refuses %s", (path) => expect(isAdditiveFile(path)).toBe(false));
});

describe("skipReason", () => {
  const repo = "dono/zuri";
  const pr = (over: Partial<PullRequest> = {}): PullRequest => ({
    number: 1,
    draft: false,
    head: { ref: "feat/etapa-10-automacoes", sha: "a".repeat(40), repo: { full_name: repo } },
    base: { ref: "develop" },
    labels: [],
    ...over,
  });

  it("updates an ordinary pull request into develop", () => expect(skipReason(pr(), repo)).toBeNull());
  it("leaves drafts alone", () => expect(skipReason(pr({ draft: true }), repo)).toBe("draft"));
  it("leaves forks alone", () => {
    expect(skipReason(pr({ head: { ref: "x", sha: "", repo: { full_name: "outra/zuri" } } }), repo)).toBe("branch from a fork");
    expect(skipReason(pr({ head: { ref: "x", sha: "", repo: null } }), repo)).toBe("branch from a fork");
  });
  it("never pushes to develop or main", () => {
    expect(skipReason(pr({ head: { ref: "main", sha: "", repo: { full_name: repo } } }), repo)).toBe("protected branch");
    expect(skipReason(pr({ head: { ref: "develop", sha: "", repo: { full_name: repo } } }), repo)).toBe("protected branch");
  });
  it("only touches pull requests into develop", () => expect(skipReason(pr({ base: { ref: "main" } }), repo)).toBe("base is main"));
  it("respects the opt-out label", () => expect(skipReason(pr({ labels: [{ name: OPT_OUT_LABEL }] }), repo)).toContain(OPT_OUT_LABEL));
});

describe("isSafeBranchName", () => {
  it.each(["feat/etapa-10-automacoes", "claude/project-thread-4rgjdn", "fix/x_1.2"])("accepts %s", (name) =>
    expect(isSafeBranchName(name)).toBe(true),
  );
  it.each(["-x", "a b", "a;rm", "a..b", "a.lock", "$(x)", "a\nb", ""])("refuses %j", (name) =>
    expect(isSafeBranchName(name)).toBe(false),
  );
});

describe("noticeBody", () => {
  it("starts with the marker, names the files and the develop commit", () => {
    const body = noticeBody({ kind: "conflict", files: ["apps/agent/src/api/app.ts"] }, "0123456789abcdef");
    expect(body.startsWith(NOTICE_MARKER)).toBe(true);
    expect(body).toContain("`apps/agent/src/api/app.ts`");
    expect(body).toContain("`0123456`");
  });
  it.each(["workflows", "clear"] as const)("has a text for %s", (kind) => {
    expect(noticeBody({ kind }, "abc1234").startsWith(NOTICE_MARKER)).toBe(true);
  });
  it("keeps file names from breaking the list or mentioning someone", () => {
    const body = noticeBody({ kind: "conflict", files: ["docs/a`b@dono"] }, "abc1234");
    expect(body).toContain("`docs/a_b_dono`");
    expect(body).not.toContain("@dono");
  });

  it("says when GitHub refused the push", () => {
    expect(noticeBody({ kind: "push-failed" }, "abc1234")).toContain("recusada");
  });

  it("asks for approval of the held runs, naming them safely", () => {
    const body = noticeBody({ kind: "approval", runs: ["CI", "a`b@c"] }, "abc1234");
    expect(body).toContain("esperando aprovação");
    expect(body).toContain("`CI`, `a_b_c`");
    expect(body).toContain("docs/configuracao-github.md");
  });

  it("lists what was resolved", () => {
    expect(noticeBody({ kind: "resolved", files: ["CHANGELOG.md"] }, "abc1234")).toContain("`CHANGELOG.md`");
  });
});

describe("notify and needsDispatch (fake gh)", () => {
  const calls: string[][] = [];
  const fake = (comments: { id: number; body: string; user: { login: string } }[], checkRuns = 0): GitHub => ({
    repository: "dono/zuri",
    baseSha: "abc1234",
    exec: (_cmd, args) => {
      calls.push(args);
      if (args[0] === "api" && args.includes("--slurp")) return JSON.stringify([comments]);
      if (args.some((a) => a.includes("check-runs"))) return `${checkRuns}\n`;
      return "";
    },
  });
  const writes = () => calls.filter((c) => c.includes("-X")).map((c) => `${c[2]} ${c[3]}`);
  afterEach(() => {
    calls.length = 0;
  });

  it("creates the comment once, then edits it", () => {
    notify(fake([]), 7, { kind: "conflict", files: ["a.ts"] });
    expect(writes()).toEqual(["POST repos/dono/zuri/issues/7/comments"]);
    calls.length = 0;
    const mine = { id: 9, body: `${NOTICE_MARKER}\nold`, user: { login: "github-actions[bot]" } };
    notify(fake([mine]), 7, { kind: "conflict", files: ["a.ts"] });
    expect(writes()).toEqual(["PATCH repos/dono/zuri/issues/comments/9"]);
  });

  it("leaves an identical comment alone and posts nothing when there is nothing to clear", () => {
    const body = noticeBody({ kind: "workflows" }, "abc1234");
    notify(fake([{ id: 9, body, user: { login: "github-actions[bot]" } }]), 7, { kind: "workflows" });
    notify(fake([]), 7, { kind: "clear" });
    expect(writes()).toEqual([]);
  });

  it("never edits a comment someone else wrote with the marker", () => {
    const forged = { id: 3, body: `${NOTICE_MARKER}\nfake`, user: { login: "someone" } };
    notify(fake([forged]), 7, { kind: "workflows" });
    expect(writes()).toEqual(["POST repos/dono/zuri/issues/7/comments"]);
  });

});

describe("approveHeldRuns (fake gh)", () => {
  const SHA = "a".repeat(40);
  const run = (id: number, name: string, extra: Partial<WorkflowRun> = {}): WorkflowRun => ({
    id,
    name,
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: SHA,
    created_at: "2026-11-02T09:03:08Z",
    actor: { login: "github-actions[bot]" },
    head_repository: { full_name: "dono/zuri" },
    ...extra,
  });
  /**
   * Each read returns the next list (GitHub creates the runs a few seconds after the push).
   * `refuse` maps a run id to how many approval calls fail before one goes through (Infinity: all).
   */
  const fake = (reads: WorkflowRun[][], refuse: number[] | Record<number, number> = [], byWorkflow: Record<string, WorkflowRun[] | Error> = {}) => {
    const approved: number[] = [];
    const calls: number[] = [];
    const asked: string[] = [];
    /** A key present with no value: GitHub answers an object without the list. */
    const answerMissing = (file: string) => file in byWorkflow && byWorkflow[file] === undefined;
    const refusals: Record<number, number> = Array.isArray(refuse)
      ? Object.fromEntries(refuse.map((id) => [id, Number.POSITIVE_INFINITY]))
      : { ...refuse };
    let read = 0;
    const exec = (_cmd: string, args: string[]) => {
      const path = args.at(-1) ?? "";
      const approve = path.match(/actions\/runs\/(\d+)\/approve$/);
      if (approve) {
        const id = Number(approve[1]);
        calls.push(id);
        if ((refusals[id] ?? 0) > 0) {
          refusals[id] = (refusals[id] ?? 0) - 1;
          throw Object.assign(new Error("gh failed"), { stderr: "gh: Server Error (HTTP 500)\n" });
        }
        approved.push(id);
        return "";
      }
      // The workflow's own newest runs, asked only for a workflow the commit's listing left out.
      const own = path.match(/^repos\/dono\/zuri\/actions\/workflows\/([a-z-]+\.yml)\/runs\?per_page=100$/);
      if (own) {
        const file = own[1] ?? "";
        asked.push(file);
        if (answerMissing(file)) return "{}";
        const answer = byWorkflow[file] ?? [];
        if (answer instanceof Error) throw answer;
        return JSON.stringify({ workflow_runs: answer });
      }
      expect(path).toBe(`repos/dono/zuri/actions/runs?head_sha=${SHA}&event=pull_request&per_page=100`);
      return JSON.stringify({ workflow_runs: reads[Math.min(read++, reads.length - 1)] });
    };
    return { ctx: { repository: "dono/zuri", exec }, approved, calls, asked, reads: () => read };
  };
  const all = () => Object.values(PR_WORKFLOWS).map((name, i) => run(i + 1, name));
  const noWait = { sleep: () => undefined };

  it("approves every run its own push started", () => {
    const { ctx, approved } = fake([all()]);
    expect(approveHeldRuns(ctx, SHA, noWait)).toEqual({ approved: ["CI", "CodeQL", "Merge order"], failed: [], errors: [], missing: [] });
    expect(approved).toEqual([1, 2, 3]);
  });

  it("waits for GitHub to create the runs, then gives up and names what is missing", () => {
    const waits: number[] = [];
    const { ctx, reads } = fake([[], [run(1, "CI")], all()]);
    expect(approveHeldRuns(ctx, SHA, { sleep: (ms) => waits.push(ms) }).missing).toEqual([]);
    expect(reads()).toBe(3);
    expect(waits).toEqual([10_000, 10_000]);
    const never = fake([[run(1, "CI")]]);
    expect(approveHeldRuns(never.ctx, SHA, { attempts: 3, ...noWait })).toEqual({
      approved: ["CI"],
      failed: [],
      errors: [],
      missing: ["CodeQL", "Merge order"],
    });
  });

  it("finds a held run the commit's listing leaves out in that workflow's own runs (issue #253)", () => {
    const listed = [run(2, "CodeQL"), run(3, "Merge order")];
    const { ctx, approved, asked, reads } = fake([listed], [], { "ci.yml": [run(9, "CI", { head_sha: "b".repeat(40) }), run(1, "CI")] });
    expect(approveHeldRuns(ctx, SHA, noWait)).toEqual({ approved: ["CodeQL", "Merge order", "CI"], failed: [], errors: [], missing: [] });
    expect(approved).toEqual([2, 3, 1]);
    // Only the workflow left out is asked, and the first read was enough.
    expect(asked).toEqual(["ci.yml"]);
    expect(reads()).toBe(1);
  });

  it("asks no workflow when the commit's listing has them all, and never takes another commit's, a fork's or a push run from there", () => {
    const whole = fake([all()]);
    approveHeldRuns(whole.ctx, SHA, noWait);
    expect(whole.asked).toEqual([]);
    const { ctx, approved } = fake([[run(2, "CodeQL"), run(3, "Merge order")]], [], {
      "ci.yml": [
        run(4, "CI", { head_sha: "b".repeat(40) }),
        run(5, "CI", { head_repository: { full_name: "outra/zuri" } }),
        run(6, "CI", { event: "push" }),
        run(7, "CodeQL"),
        run(8, "CI", { actor: { login: "outra-pessoa" } }),
      ],
    });
    const result = approveHeldRuns(ctx, SHA, { attempts: 1 });
    expect(approved).toEqual([2, 3]);
    // Someone else's run on the same commit counts as present, and is never approved.
    expect(result.missing).toEqual([]);
    const none = fake([[run(2, "CodeQL"), run(3, "Merge order")]], [], { "ci.yml": [run(4, "CI", { head_sha: "b".repeat(40) }), run(6, "CI", { event: "push" })] });
    expect(approveHeldRuns(none.ctx, SHA, { attempts: 1 }).missing).toEqual(["CI"]);
  });

  it("keeps the workflow as missing when its own runs come back without a list", () => {
    const { ctx } = fake([[run(2, "CodeQL"), run(3, "Merge order")]], [], { "ci.yml": undefined as unknown as WorkflowRun[] });
    expect(approveHeldRuns(ctx, SHA, { attempts: 1 }).missing).toEqual(["CI"]);
  });

  it("keeps the workflow as missing when its own runs can't be read", () => {
    const { ctx, approved } = fake([[run(2, "CodeQL"), run(3, "Merge order")]], [], { "ci.yml": Object.assign(new Error("gh failed"), { stderr: "gh: Bad Gateway (HTTP 502)\n" }) });
    expect(approveHeldRuns(ctx, SHA, { attempts: 1 })).toEqual({ approved: ["CodeQL", "Merge order"], failed: [], errors: [], missing: ["CI"] });
    expect(approved).toEqual([2, 3]);
  });

  it("never approves a run someone else started, a fork's, another commit's or one already running", () => {
    const { ctx, approved } = fake([
      [
        run(1, "CI", { actor: { login: "outra-pessoa" } }),
        run(2, "CodeQL", { head_repository: { full_name: "outra/zuri" } }),
        run(3, "Merge order", { conclusion: "success" }),
        run(4, "CI", { head_sha: "b".repeat(40) }),
        run(5, "CI", { event: "workflow_dispatch" }),
      ],
    ]);
    const result = approveHeldRuns(ctx, SHA, { attempts: 1 });
    expect(approved).toEqual([]);
    expect(result.approved).toEqual([]);
    // The fork's and the other commit's runs do not count as present either.
    expect(result.missing).toEqual(["CodeQL"]);
  });

  it("reports a refused approval, with GitHub's answer, without stopping the others", () => {
    const { ctx, approved, calls } = fake([all()], [2]);
    expect(approveHeldRuns(ctx, SHA, noWait)).toEqual({
      approved: ["CI", "Merge order"],
      failed: ["CodeQL"],
      errors: ["CodeQL: gh: Server Error (HTTP 500)"],
      missing: [],
    });
    expect(approved).toEqual([1, 3]);
    expect(calls.filter((id) => id === 2)).toHaveLength(APPROVE_ATTEMPTS);
  });

  it("retries an approval GitHub refused once (issue #201)", () => {
    const waits: number[] = [];
    const { ctx, approved } = fake([all()], { 3: 1 });
    expect(approveHeldRuns(ctx, SHA, { sleep: (ms) => waits.push(ms) })).toEqual({
      approved: ["CI", "CodeQL", "Merge order"],
      failed: [],
      errors: [],
      missing: [],
    });
    expect(approved).toEqual([1, 2, 3]);
    expect(waits).toEqual([10_000]);
  });

  it("counts an approval that answered an error but took, once the run left action_required (issues #166 and #190)", () => {
    const started = all().map((r) => (r.name === "Merge order" ? { ...r, status: "queued", conclusion: null } : r));
    const { ctx, calls } = fake([all(), started], [3]);
    expect(approveHeldRuns(ctx, SHA, noWait)).toEqual({
      approved: ["CI", "CodeQL", "Merge order"],
      failed: [],
      errors: [],
      missing: [],
    });
    // The run moved on, so it is never approved a second time.
    expect(calls).toEqual([1, 2, 3]);
  });
});

describe("approveLateRuns (fake gh)", () => {
  const SHA_A = "a".repeat(40);
  const SHA_B = "b".repeat(40);
  const run = (id: number, name: string, sha: string, extra: Partial<WorkflowRun> = {}): WorkflowRun => ({
    id,
    name,
    event: "pull_request",
    status: "completed",
    conclusion: "action_required",
    head_sha: sha,
    created_at: "2026-11-09T09:53:07Z",
    actor: { login: "github-actions[bot]" },
    head_repository: { full_name: "dono/zuri" },
    ...extra,
  });
  const all = (sha: string, base: number) => Object.values(PR_WORKFLOWS).map((name, i) => run(base + i, name, sha));
  /** A clock the fake sleep moves forward; `reads[sha]` gives the list of each read of that commit. */
  const fake = (reads: Record<string, WorkflowRun[][]>, failReads: Record<string, number> = {}, own: WorkflowRun[] = []) => {
    let clock = 0;
    const approved: number[] = [];
    const count: Record<string, number> = {};
    const exec = (_cmd: string, args: string[]) => {
      const path = args.at(-1) ?? "";
      const approve = path.match(/actions\/runs\/(\d+)\/approve$/);
      if (approve) {
        approved.push(Number(approve[1]));
        return "";
      }
      // A workflow's own newest runs (asked for one the commit's listing left out): none here.
      if (path.includes("/actions/workflows/")) {
        count.own = (count.own ?? 0) + 1;
        return JSON.stringify({ workflow_runs: path.includes("/ci.yml/") ? own : [] });
      }
      const sha = path.match(/head_sha=([0-9a-f]{40})/)?.[1] ?? "";
      const n = count[sha] ?? 0;
      count[sha] = n + 1;
      if (n < (failReads[sha] ?? 0)) throw Object.assign(new Error("gh failed"), { stderr: "gh: Bad Gateway (HTTP 502)\n" });
      const list = reads[sha] ?? [[]];
      return JSON.stringify({ workflow_runs: list[Math.min(n, list.length - 1)] });
    };
    return {
      ctx: { repository: "dono/zuri", exec },
      approved,
      count,
      opts: { now: () => clock, sleep: (ms: number) => (clock += ms) },
    };
  };

  it("approves runs GitHub creates 9 minutes after the push (issue #210)", () => {
    // One read every 20 s: the runs show up on the 28th read, 9 minutes in.
    const reads = [...Array.from({ length: 27 }, () => [] as WorkflowRun[]), all(SHA_A, 1)];
    const { ctx, approved, opts } = fake({ [SHA_A]: reads });
    const [result] = approveLateRuns(ctx, [{ sha: SHA_A, pushedAt: 0, approved: [] }], { deadline: RUN_BUDGET_MS, ...opts });
    expect(result).toEqual({ approved: ["CI", "CodeQL", "Merge order"], failed: [], errors: [], missing: [] });
    expect(approved).toEqual([1, 2, 3]);
    expect(opts.now()).toBe(9 * 60_000);
  });

  it("approves at the first read a run only its workflow's own runs show (issue #253)", () => {
    const [ci, ...others] = all(SHA_A, 1);
    const { ctx, approved, opts } = fake({ [SHA_A]: [others] }, {}, ci ? [ci] : []);
    const [result] = approveLateRuns(ctx, [{ sha: SHA_A, pushedAt: 0, approved: ["CodeQL", "Merge order"] }], { deadline: RUN_BUDGET_MS, ...opts });
    expect(result).toEqual({ approved: ["CodeQL", "Merge order", "CI"], failed: [], errors: [], missing: [] });
    expect(approved).toEqual([2, 3, 1]);
    expect(opts.now()).toBe(0);
  });

  it("reads each workflow's own runs once per round, however many commits wait (hourly API limit)", () => {
    const { ctx, count, opts } = fake({ [SHA_A]: [[], all(SHA_A, 1)], [SHA_B]: [[], all(SHA_B, 11)] });
    approveLateRuns(ctx, [SHA_A, SHA_B].map((sha) => ({ sha, pushedAt: 0, approved: [] })), { deadline: RUN_BUDGET_MS, ...opts });
    // First round: nothing listed for either commit, so the three workflows are asked, once for both.
    expect(count.own).toBe(Object.keys(PR_WORKFLOWS).length);
  });

  it("waits for several commits in the same loop and keeps what the first round approved", () => {
    const { ctx, approved, count, opts } = fake({
      [SHA_A]: [[run(1, "CI", SHA_A, { conclusion: null, status: "queued" })], all(SHA_A, 1).map((r) => (r.name === "CI" ? { ...r, conclusion: null, status: "queued" } : r))],
      [SHA_B]: [[], [], all(SHA_B, 11)],
    });
    const results = approveLateRuns(
      ctx,
      [
        { sha: SHA_A, pushedAt: 0, approved: ["CI"] },
        { sha: SHA_B, pushedAt: 0, approved: [] },
      ],
      { deadline: RUN_BUDGET_MS, ...opts },
    );
    expect(results.map((r) => r.approved)).toEqual([["CI", "CodeQL", "Merge order"], ["CI", "CodeQL", "Merge order"]]);
    expect(results.every((r) => r.missing.length === 0 && r.failed.length === 0)).toBe(true);
    expect(approved).toEqual([2, 3, 11, 12, 13]);
    // A done commit is not read again, and both waited together: 40 s, not 60 s.
    expect(count[SHA_A]).toBe(2);
    expect(opts.now()).toBe(40_000);
  });

  it("gives up LATE_RUNS_MS after the push, approving what showed up and naming the rest", () => {
    const { ctx, approved, opts } = fake({ [SHA_A]: [[run(1, "CI", SHA_A)]] });
    const [result] = approveLateRuns(ctx, [{ sha: SHA_A, pushedAt: 0, approved: [] }], { deadline: 60 * 60_000, ...opts });
    expect(result).toEqual({ approved: ["CI"], failed: [], errors: [], missing: ["CodeQL", "Merge order"] });
    expect(approved).toEqual([1]);
    expect(opts.now()).toBe(LATE_RUNS_MS);
  });

  it("never waits past the deadline that keeps the job inside its timeout", () => {
    const { ctx, opts } = fake({});
    const [result] = approveLateRuns(ctx, [{ sha: SHA_A, pushedAt: 0, approved: [] }], { deadline: 60_000, ...opts });
    expect(result?.missing).toEqual(["CI", "CodeQL", "Merge order"]);
    expect(opts.now()).toBe(60_000);
  });

  it("gives up on each commit LATE_RUNS_MS after its own push", () => {
    const { ctx, count, opts } = fake({});
    const results = approveLateRuns(
      ctx,
      [
        { sha: SHA_A, pushedAt: 0, approved: [] },
        { sha: SHA_B, pushedAt: 60_000, approved: [] },
      ],
      { deadline: 60 * 60_000, ...opts },
    );
    expect(results.map((r) => r.missing.length)).toEqual([3, 3]);
    expect(opts.now()).toBe(LATE_RUNS_MS + 60_000);
    // One more read for B: it was still waiting while A had given up.
    expect((count[SHA_B] ?? 0) - (count[SHA_A] ?? 0)).toBe(3);
  });

  it("reads once and stops when the deadline already passed", () => {
    const { ctx, count, opts } = fake({ [SHA_A]: [[run(1, "CI", SHA_A)]] });
    opts.sleep(5 * 60_000);
    const [result] = approveLateRuns(ctx, [{ sha: SHA_A, pushedAt: 0, approved: [] }], { deadline: 60_000, ...opts });
    expect(result?.approved).toEqual(["CI"]);
    expect(count[SHA_A]).toBe(1);
    expect(opts.now()).toBe(5 * 60_000);
  });

  it("names a run approved in the first round once, even if it still reads as held", () => {
    const { ctx, opts } = fake({ [SHA_A]: [all(SHA_A, 1)] });
    const [result] = approveLateRuns(ctx, [{ sha: SHA_A, pushedAt: 0, approved: ["CI"] }], { deadline: RUN_BUDGET_MS, ...opts });
    expect(result?.approved).toEqual(["CI", "CodeQL", "Merge order"]);
  });

  it("retries a refused approval with short waits once the wait is over", () => {
    const { ctx, opts } = fake({ [SHA_A]: [all(SHA_A, 1)] });
    const exec = ctx.exec;
    let refused = 0;
    const flaky = {
      ...ctx,
      exec: (cmd: string, args: string[]) => {
        if (/runs\/3\/approve$/.test(args.at(-1) ?? "") && refused++ === 0) throw Object.assign(new Error("gh failed"), { stderr: "HTTP 500\n" });
        return exec(cmd, args);
      },
    };
    const [result] = approveLateRuns(flaky, [{ sha: SHA_A, pushedAt: 0, approved: [] }], { deadline: RUN_BUDGET_MS, ...opts });
    expect(result?.approved).toEqual(["CI", "CodeQL", "Merge order"]);
    expect(opts.now()).toBe(LATE_APPROVE_RETRY_MS);
  });

  it("keeps waiting through a failed read", () => {
    const { ctx, approved, opts } = fake({ [SHA_A]: [all(SHA_A, 1)] }, { [SHA_A]: 2 });
    const [result] = approveLateRuns(ctx, [{ sha: SHA_A, pushedAt: 0, approved: [] }], { deadline: RUN_BUDGET_MS, ...opts });
    expect(result?.missing).toEqual([]);
    expect(approved).toEqual([1, 2, 3]);
  });

  it("never approves a run someone else started or a fork's while waiting", () => {
    const { ctx, approved, opts } = fake({
      [SHA_A]: [[run(1, "CI", SHA_A, { actor: { login: "outra-pessoa" } }), run(2, "CodeQL", SHA_A, { head_repository: { full_name: "outra/zuri" } }), run(3, "Merge order", SHA_A)]],
    });
    const [result] = approveLateRuns(ctx, [{ sha: SHA_A, pushedAt: 0, approved: [] }], { deadline: RUN_BUDGET_MS, ...opts });
    expect(approved).toEqual([3]);
    expect(result?.missing).toEqual(["CodeQL"]);
  });

  it("fits the wait inside the update job's timeout", () => {
    const workflow = readFileSync(join(import.meta.dirname, "../../.github/workflows/update-prs.yml"), "utf8");
    const minutes = Number(workflow.match(/^ {4}timeout-minutes: (\d+)$/m)?.[1]);
    // Worst case: the budget, then 3 refused approvals (3 calls, 4 waits) for 3 runs of each of 5 late pull requests.
    expect(RUN_BUDGET_MS + 5 * 3 * 4 * LATE_APPROVE_RETRY_MS).toBeLessThan((minutes - 2) * 60_000);
    expect(LATE_RUNS_MS).toBeGreaterThan(9 * 60_000);
  });
});

describe("mergeBase (real git)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const git = (dir: string, ...args: string[]) =>
    execFileSync("git", args, {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: "t",
        GIT_AUTHOR_EMAIL: "t@exemplo.com.br",
        GIT_COMMITTER_NAME: "t",
        GIT_COMMITTER_EMAIL: "t@exemplo.com.br",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    });
  const write = (dir: string, file: string, text: string) => {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  };
  const commit = (dir: string, message: string) => {
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "--allow-empty", "-m", message);
  };

  /** A repository with develop and a PR branch, each changing the files after the common commit. */
  function repo(base: Record<string, string>, develop: Record<string, string>, branch: Record<string, string>) {
    const dir = mkdtempSync(join(tmpdir(), "atualizar-prs-"));
    dirs.push(dir);
    git(dir, "init", "-q", "-b", "develop");
    for (const [file, text] of Object.entries(base)) write(dir, file, text);
    commit(dir, "base");
    git(dir, "checkout", "-q", "-b", "pr");
    for (const [file, text] of Object.entries(branch)) write(dir, file, text);
    commit(dir, "pr");
    git(dir, "checkout", "-q", "develop");
    for (const [file, text] of Object.entries(develop)) write(dir, file, text);
    commit(dir, "develop");
    git(dir, "checkout", "-q", "pr");
    return dir;
  }
  const run = (_cmd: string, args: string[], options: { cwd?: string } = {}) => git(options.cwd ?? ".", ...args);

  it("reports a branch that already has develop", () => {
    const dir = repo({ "a.txt": "a\n" }, {}, { "b.txt": "b\n" });
    git(dir, "merge", "-q", "--no-edit", "develop");
    expect(mergeBase(dir, "develop", run)).toEqual({ status: "up-to-date" });
  });

  it("merges without conflict", () => {
    const dir = repo({ "a.txt": "a\n" }, { "a.txt": "a\nfrom develop\n" }, { "b.txt": "b\n" });
    expect(mergeBase(dir, "develop", run)).toEqual({ status: "merged", resolved: [] });
    expect(git(dir, "log", "-1", "--format=%s")).toContain(MERGE_MESSAGE);
  });

  it("resolves two changelog entries at the same place and commits", () => {
    const base = "## Não lançado\n\n### Adicionado\n\n- old\n";
    const dir = repo(
      { "CHANGELOG.md": base },
      { "CHANGELOG.md": base.replace("- old", "- develop\n- old") },
      { "CHANGELOG.md": base.replace("- old", "- pr\n- old") },
    );
    expect(mergeBase(dir, "develop", run)).toEqual({ status: "merged", resolved: ["CHANGELOG.md"] });
    expect(readFileSync(join(dir, "CHANGELOG.md"), "utf8")).toBe(base.replace("- old", "- develop\n- pr\n- old"));
    expect(git(dir, "status", "--porcelain")).toBe("");
    expect(git(dir, "rev-list", "--parents", "-1", "HEAD").trim().split(" ")).toHaveLength(3);
  });

  it("aborts and names the files when a conflict needs a person", () => {
    const dir = repo(
      { "CHANGELOG.md": "- old\n", "app.ts": "const a = 1;\n" },
      { "CHANGELOG.md": "- develop\n- old\n", "app.ts": "const a = 2;\n" },
      { "CHANGELOG.md": "- pr\n- old\n", "app.ts": "const a = 3;\n" },
    );
    const head = git(dir, "rev-parse", "HEAD");
    expect(mergeBase(dir, "develop", run)).toEqual({ status: "conflict", files: ["app.ts"] });
    expect(git(dir, "rev-parse", "HEAD")).toBe(head);
    expect(git(dir, "status", "--porcelain")).toBe("");
  });

  it("aborts the whole merge when one file needs a person, discarding the resolved ones", () => {
    const dir = repo(
      { "CHANGELOG.md": "- old\n", "app.ts": "const a = 1;\n" },
      { "CHANGELOG.md": "- develop\n- old\n", "app.ts": "const a = 2;\n" },
      { "CHANGELOG.md": "- pr\n- old\n", "app.ts": "const a = 3;\n" },
    );
    mergeBase(dir, "develop", run);
    expect(readFileSync(join(dir, "CHANGELOG.md"), "utf8")).toBe("- pr\n- old\n");
  });

  it("leaves a file both sides created for a person", () => {
    const dir = repo({ "a.txt": "a\n" }, { "changelog/nao-lancado/x.md": "- develop\n" }, { "changelog/nao-lancado/x.md": "- pr\n" });
    expect(mergeBase(dir, "develop", run)).toEqual({ status: "conflict", files: ["changelog/nao-lancado/x.md"] });
  });

  it("leaves an edited line in an additive file for a person", () => {
    const dir = repo({ "README.md": "| 9 | old |\n" }, { "README.md": "| 9 | develop |\n" }, { "README.md": "| 9 | pr |\n" });
    expect(mergeBase(dir, "develop", run)).toEqual({ status: "conflict", files: ["README.md"] });
  });

  it("leaves a file deleted on one side for a person", () => {
    const dir = repo({ "README.md": "a\nb\n" }, { "README.md": "a\nb\nc\n" }, {});
    git(dir, "rm", "-q", "README.md");
    git(dir, "commit", "-q", "-m", "rm");
    expect(mergeBase(dir, "develop", run)).toEqual({ status: "conflict", files: ["README.md"] });
  });

  it("throws, without leaving a merge behind, when git refuses to start", () => {
    const dir = repo({ "a.txt": "a\n" }, { "a.txt": "a\ndevelop\n" }, {});
    write(dir, "a.txt", "dirty\n");
    expect(() => mergeBase(dir, "develop", run)).toThrow(/git merge failed/);
  });
});
