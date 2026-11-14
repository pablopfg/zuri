import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  CI_PART_JOBS,
  loadWorkflow,
  REQUIRED_CI_JOBS,
  REQUIRED_CODEQL_CHECKS,
  REQUIRED_ORDER_CHECK,
  readText,
  triggers,
  workflowFiles,
} from "./helpers.ts";

const PINNED_RUNNER = "ubuntu-26.04";
const files = workflowFiles();
const all = files.map((path) => ({ path, wf: loadWorkflow(path), text: readText(path) }));
const steps = (wf: ReturnType<typeof loadWorkflow>) => Object.values(wf.jobs).flatMap((job) => job.steps ?? []);

describe("GitHub Actions workflows", () => {
  it("exist", () => {
    expect(files).toContain(".github/workflows/ci.yml");
    expect(files).toContain(".github/workflows/branch-policy.yml");
    expect(files).toContain(".github/workflows/codeql.yml");
  });

  it.each(all)("$path pins every action to a full commit SHA", ({ wf }) => {
    for (const step of steps(wf)) {
      if (!step.uses || step.uses.startsWith("./")) continue;
      expect(step.uses, step.uses).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
    }
  });

  it.each(all)("$path pins reusable workflows to a full commit SHA", ({ wf }) => {
    for (const job of Object.values(wf.jobs)) {
      const uses = (job as { uses?: string }).uses;
      if (!uses || uses.startsWith("./")) continue;
      expect(uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });

  it.each(all)("$path grants pull request jobs no write permission beyond CodeQL results", ({ path, wf }) => {
    if (!triggers(wf).includes("pull_request")) return;
    for (const [name, job] of Object.entries(wf.jobs)) {
      if (job.permissions === undefined) continue;
      expect(typeof job.permissions, `${name} permissions`).toBe("object");
      for (const [scope, level] of Object.entries(job.permissions as Record<string, string>)) {
        const allowed = path.endsWith("codeql.yml") && scope === "security-events" && level === "write";
        if (!allowed) expect(["read", "none"], `${name} ${scope}`).toContain(level);
      }
    }
  });

  it.each(all)("$path declares top-level permissions", ({ wf }) => {
    expect(wf.permissions, "top-level permissions").toBeDefined();
    expect(JSON.stringify(wf.permissions)).not.toMatch(/write-all|read-all/);
  });

  // ubuntu-latest moves to a new Ubuntu release on GitHub's schedule (24.04 to
  // 26.04 from October 2026), so the image under the suite would change
  // without a commit. Every job names the release it was tested on.
  it.each(all)("$path pins every job to a fixed Ubuntu runner", ({ wf }) => {
    for (const [name, job] of Object.entries(wf.jobs)) {
      const runsOn = (job as { "runs-on"?: unknown })["runs-on"];
      if (runsOn === undefined) continue;
      expect(runsOn, `${name} runs-on`).toBe(PINNED_RUNNER);
    }
  });

  it.each(all)("$path checks out without persisting credentials", ({ wf }) => {
    for (const step of steps(wf)) {
      if (step.uses?.startsWith("actions/checkout@")) {
        expect(step.with?.["persist-credentials"]).toBe(false);
      }
    }
  });

  it.each(all)("$path never uses pull_request_target or workflow_run", ({ wf }) => {
    expect(triggers(wf)).not.toContain("pull_request_target");
    expect(triggers(wf)).not.toContain("workflow_run");
  });

  it.each(all)("$path gives pull request jobs no secret and no environment", ({ path, wf, text }) => {
    if (!triggers(wf).includes("pull_request")) return;
    // The one exception, the owner's choice (13/11/2026): SonarQube Cloud reads
    // SONAR_TOKEN, and only as the env of a step, never inside a shell line.
    if (path.endsWith("sonarqube.yml")) {
      expect(text.match(/secrets\.\w+/g)?.every((use) => use === "secrets.SONAR_TOKEN")).toBe(true);
      for (const step of steps(wf)) expect(step.run ?? "").not.toMatch(/secrets\./);
    } else {
      expect(text).not.toMatch(/secrets\./);
    }
    for (const [name, job] of Object.entries(wf.jobs)) {
      expect(job.environment, `${name} environment`).toBeUndefined();
    }
  });

  it.each(all)("$path never interpolates event data straight into a shell", ({ wf }) => {
    for (const step of steps(wf)) {
      expect(step.run ?? "", step.run).not.toMatch(/\$\{\{[^}]*(github\.event|github\.head_ref|inputs\.)/);
    }
  });

  it("runs CI on pull requests, on pushes to develop and when the deploy calls it, with read-only contents", () => {
    const ci = loadWorkflow(".github/workflows/ci.yml");
    // No workflow_dispatch: the rulesets count only pull_request runs (#60 waited on "expected" checks).
    // The push run on develop is what the README badge (?branch=develop) reads.
    // workflow_call: deploy.yml runs the same jobs on main before it deploys (step 24).
    expect(ci.on).toEqual({ pull_request: null, push: { branches: ["develop"] }, workflow_call: null });
    expect(ci.permissions).toEqual({ contents: "read" });
    const text = readText(".github/workflows/ci.yml");
    // Each pull request gets its own group; develop gets one group too.
    expect(text).toContain(`group: ci-\${{ github.event.pull_request.number || github.ref }}`);
    // Only a pull request cancels its older run: every develop run finishes, so the badge never reads "cancelled".
    expect(text).toContain(`cancel-in-progress: \${{ github.event_name == 'pull_request' }}`);
  });

  it("has one CI job per required check", () => {
    const ci = loadWorkflow(".github/workflows/ci.yml");
    expect(Object.keys(ci.jobs).sort()).toEqual([...REQUIRED_CI_JOBS, ...CI_PART_JOBS].sort());
    for (const [name, job] of Object.entries(ci.jobs)) {
      // The check context is the job name when set, otherwise the job id.
      if (!CI_PART_JOBS.includes(name)) expect(job.name ?? name).toBe(name);
      // A part never takes the name of a required check.
      else expect(REQUIRED_CI_JOBS.some((required) => job.name === required)).toBe(false);
    }
  });

  it("audits dependencies for high or critical advisories", () => {
    const ci = loadWorkflow(".github/workflows/ci.yml");
    const runs = (ci.jobs.audit?.steps ?? []).map((s) => s.run);
    expect(runs).toContain("npm audit --audit-level=high");
  });

  it("runs CodeQL on pull requests, on pushes to develop and weekly, with the extended queries", () => {
    const codeql = loadWorkflow(".github/workflows/codeql.yml");
    expect(triggers(codeql).sort()).toEqual(["pull_request", "push", "schedule"]);
    expect((codeql.on as { push: unknown }).push).toEqual({ branches: ["develop"] });
    const text = readText(".github/workflows/codeql.yml");
    expect(text).toContain(`cancel-in-progress: \${{ github.event_name == 'pull_request' }}`);
    expect(text).toContain("queries: security-extended");
    expect(text).toMatch(/language: \[javascript-typescript, actions\]/);
  });

  it("lets only develop open pull requests into main", () => {
    const policy = loadWorkflow(".github/workflows/branch-policy.yml");
    expect(policy.on).toEqual({ pull_request: { branches: ["main"] } });
    expect(policy.permissions).toEqual({});
    const script = policy.jobs["source-branch"]?.steps?.[0]?.run ?? "";
    expect(script).toContain('"$HEAD_REF" != "develop"');
    expect(script).toContain('"$HEAD_REPO" != "$BASE_REPO"');
  });
});

describe("update-prs workflow", () => {
  const wf = loadWorkflow(".github/workflows/update-prs.yml");
  const job = wf.jobs.update;

  it("runs when develop moves, every 15 minutes, or by hand", () => {
    expect(wf.on).toEqual({ push: { branches: ["develop"] }, schedule: [{ cron: "*/15 * * * *" }], workflow_dispatch: null });
  });

  it("refreshes stale merge-order results after updating the branches", () => {
    const runs = job?.steps?.map((step) => step.run ?? "") ?? [];
    expect(runs.at(-1)).toBe("node scripts/ordem-de-merge.ts --atualizar");
  });

  it("has no permission at the top and only what it needs in the job", () => {
    expect(wf.permissions).toEqual({});
    expect(job?.permissions).toEqual({ contents: "write", "pull-requests": "write", actions: "write" });
    expect(job?.environment).toBeUndefined();
    expect(readText(".github/workflows/update-prs.yml")).not.toMatch(/secrets\./);
  });

  it("runs the script from develop, never from a pull request branch", () => {
    const checkout = job?.steps?.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.ref).toBe("develop");
    const run = job?.steps?.map((step) => step.run ?? "").join("\n") ?? "";
    expect(run).toContain("node scripts/atualizar-prs.ts");
    expect(run).not.toMatch(/npm (ci|install)/);
  });

  it("approves the pull_request runs of every workflow that reports a required check", async () => {
    const { PR_WORKFLOWS } = await import("../../scripts/atualizar-prs.ts");
    const required = new Set([...REQUIRED_CI_JOBS, ...REQUIRED_CODEQL_CHECKS, REQUIRED_ORDER_CHECK]);
    const reporting = workflowFiles()
      .filter((path) => {
        const w = loadWorkflow(path);
        return Object.entries(w.jobs).some(([id, j]) => required.has(j.name?.replace(`\${{ matrix.language }}`, "javascript-typescript") ?? id));
      })
      .map((path) => path.replace(".github/workflows/", ""));
    expect(Object.keys(PR_WORKFLOWS).sort()).toEqual(reporting.sort());
    for (const [file, name] of Object.entries(PR_WORKFLOWS)) {
      const w = loadWorkflow(`.github/workflows/${file}`);
      // The run name is how the script finds the run to approve.
      expect(w.name).toBe(name);
      expect(triggers(w)).toContain("pull_request");
    }
  });
});

// Workflows that write to the repository from develop: never on a pull request,
// only GITHUB_TOKEN, and only the permissions their script needs.
describe.each([
  {
    file: ".github/workflows/readme.yml",
    job: "update",
    cron: "2,12,22,32,42,52 * * * *",
    script: "node scripts/readme.ts --publicar",
    permissions: { contents: "write", "pull-requests": "write", actions: "write" },
  },
  {
    file: ".github/workflows/branches.yml",
    job: "delete-merged",
    cron: "7,17,27,37,47,57 * * * *",
    script: "node scripts/limpar-branches.ts",
    permissions: { contents: "write", "pull-requests": "read" },
  },
])("$file", ({ file, job: jobId, cron, script, permissions }) => {
  const wf = loadWorkflow(file);
  const job = wf.jobs[jobId] as (typeof wf.jobs)[string] & { if?: string };

  it("runs when develop moves, every 10 minutes, or by hand, never on a pull request", () => {
    expect(wf.on).toEqual({ push: { branches: ["develop"] }, schedule: [{ cron }], workflow_dispatch: null });
    expect(job.if).toBe("github.ref == 'refs/heads/develop'");
  });

  it("has no permission at the top and only what it needs in the job", () => {
    expect(wf.permissions).toEqual({});
    expect(job.permissions).toEqual(permissions);
    expect(job.environment).toBeUndefined();
    expect(readText(file)).not.toMatch(/secrets\./);
  });

  it("runs its script from develop without installing anything", () => {
    const checkout = job.steps?.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.ref).toBe("develop");
    const runs = (job.steps ?? []).flatMap((step) => (step.run ? [step.run] : [])).join("\n");
    expect(runs).toContain(script);
    expect(runs).not.toMatch(/npm (ci|install)/);
  });

  it("opens an issue when it fails", () => {
    const report = wf.jobs["report-failure"] as (typeof wf.jobs)[string] & { needs?: string };
    expect(report.needs).toBe(jobId);
    expect(report.permissions).toEqual({ issues: "write", actions: "read" });
  });
});

describe("source-branch check", () => {
  const script = loadWorkflow(".github/workflows/branch-policy.yml").jobs["source-branch"]?.steps?.[0]?.run ?? "";
  const run = (env: Record<string, string>) => {
    try {
      execFileSync("bash", ["-c", script], { env: { PATH: process.env.PATH ?? "", ...env }, stdio: "pipe" });
      return 0;
    } catch (error) {
      return (error as { status: number }).status;
    }
  };
  const repo = "dono/zuri";

  it("accepts develop from this repository", () => {
    expect(run({ HEAD_REF: "develop", HEAD_REPO: repo, BASE_REPO: repo })).toBe(0);
  });

  it("refuses any other branch", () => {
    expect(run({ HEAD_REF: "feat/etapa-01-worker", HEAD_REPO: repo, BASE_REPO: repo })).toBe(1);
    expect(run({ HEAD_REF: "develop2", HEAD_REPO: repo, BASE_REPO: repo })).toBe(1);
  });

  it("refuses a fork branch named develop", () => {
    expect(run({ HEAD_REF: "develop", HEAD_REPO: "outra-pessoa/zuri", BASE_REPO: repo })).toBe(1);
  });
});

describe(".github/workflows/sonarqube.yml", () => {
  const wf = loadWorkflow(".github/workflows/sonarqube.yml");
  const jobSteps = (id: string) => wf.jobs[id]?.steps ?? [];
  const withToken = (id: string) => jobSteps(id).filter((step) => JSON.stringify(step.env ?? {}).includes("secrets.SONAR_TOKEN"));

  it("runs on pull requests and on pushes to develop, read only", () => {
    expect(wf.on).toEqual({ pull_request: null, push: { branches: ["develop"] } });
    expect(wf.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(wf.jobs)) expect(job.permissions).toBeUndefined();
  });

  // SEC-A11-02: a postinstall or a test of the pull request could rewrite the
  // scanner or $GITHUB_ENV before the step that holds the token.
  it("SEC-A11-02 never runs the pull request's code in a job that holds the token", () => {
    expect(withToken("token").map((step) => step.id)).toEqual(["check"]);
    expect(jobSteps("token").filter((step) => step.uses)).toEqual([]);
    expect(withToken("coverage")).toEqual([]);
    expect(withToken("sonarqube").map((step) => step.uses)).toEqual(["SonarSource/sonarqube-scan-action@59202af334b4ba7b5db01b701b8e79f8b3bef0f4"]);
    // An exact list, not a list of what is forbidden: a local action or any other command would come from the pull request.
    expect(jobSteps("sonarqube").map((step) => step.uses ?? step.run)).toEqual([
      "actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1",
      "actions/download-artifact@9000827ccba6bdab643e8b6fd33ac0654aef8333",
      ': > "$RUNNER_TEMP/sonar.properties"',
      "SonarSource/sonarqube-scan-action@59202af334b4ba7b5db01b701b8e79f8b3bef0f4",
    ]);
  });

  it("SEC-A11-02 fixes the server and reads no settings file from the pull request", () => {
    const scan = withToken("sonarqube")[0];
    const args = String((scan?.with as Record<string, unknown> | undefined)?.args ?? "");
    expect(args).toContain("-Dsonar.host.url=https://sonarcloud.io");
    expect(args).toMatch(/-Dproject\.settings=\$\{\{ runner\.temp \}\}\/sonar\.properties/);
    expect(existsSync("sonar-project.properties")).toBe(false);
  });

  it("ends green without a scan when the secret does not reach the run (fork, Dependabot)", () => {
    const check = jobSteps("token").find((step) => step.id === "check");
    expect(check?.run).toContain('[ -z "$SONAR_TOKEN" ]');
    expect(check?.run).toContain('echo "run=false" >> "$GITHUB_OUTPUT"');
    expect((wf.jobs.coverage as { if?: string }).if).toBe("needs.token.outputs.run == 'true'");
    expect((wf.jobs.sonarqube as { needs?: string }).needs).toBe("coverage");
  });
});

describe("security scans of the CI (docs/qa/varreduras-de-seguranca.md)", () => {
  const ci = loadWorkflow(".github/workflows/ci.yml");

  it("runs Semgrep in the image pinned by digest, from the pinned script", () => {
    const job = ci.jobs.semgrep as (typeof ci.jobs)[string] & { container?: { image?: string } };
    expect(job.container?.image).toMatch(/^semgrep\/semgrep@sha256:[0-9a-f]{64}$/);
    expect(job.steps?.map((step) => step.run).filter(Boolean)).toContain("bash scripts/seguranca/semgrep.sh");
    const script = readText("scripts/seguranca/semgrep.sh");
    expect(script).toMatch(/^RULES_SHA=[0-9a-f]{40}$/m);
    expect(script).toContain("--metrics=off");
    expect(script).toContain("--error");
  });

  it("runs Gitleaks over the whole history, with a binary checked against its SHA-256", () => {
    const job = ci.jobs.gitleaks;
    const checkout = job?.steps?.find((step) => step.uses?.startsWith("actions/checkout@"));
    expect(checkout?.with?.["fetch-depth"]).toBe(0);
    expect(job?.steps?.map((step) => step.run).filter(Boolean)).toContain("bash scripts/seguranca/gitleaks.sh");
    const script = readText("scripts/seguranca/gitleaks.sh");
    expect(script.match(/SHA256=[0-9a-f]{64} ;;/g)).toHaveLength(4);
    expect(script).toContain("sha256sum -c");
    expect(script).toContain("--redact");
  });

  it("allows only exact test values in .gitleaks.toml, never a path, a rule or a whole commit", () => {
    const config = readText(".gitleaks.toml");
    for (const key of ["paths", "stopwords", "commits", "disabledRules"]) expect(config).not.toMatch(new RegExp(`^\\s*${key}\\s*=`, "m"));
    expect(config).toMatch(/^useDefault = true$/m);
    const values = [...config.matchAll(/'''(.*)'''/g)].map((match) => match[1]);
    expect(values.length).toBeGreaterThan(0);
    // Literal characters and escapes only: no class, quantifier, dot or alternation.
    for (const value of values) expect(value).toMatch(/^\^(?:[A-Za-z0-9_=-]|\\.)+\$$/);
  });

  it("has no file that turns a scan off in bulk", () => {
    expect(existsSync(".gitleaksignore")).toBe(false);
    expect(existsSync(".semgrepignore")).toBe(false);
  });
});
