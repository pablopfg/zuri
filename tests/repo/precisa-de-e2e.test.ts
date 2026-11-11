import { execFileSync } from "node:child_process";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  type Change,
  decide,
  decideFromCheckout,
  isTextOnly,
  onlyVersionChanged,
  versionFilesOf,
  workspacesOf,
} from "../../scripts/precisa-de-e2e.ts";
import { LOCK_FILE, VERSION_FILE, versionFiles, writeVersion } from "../../scripts/versao.ts";
import { loadWorkflow, ROOT, readText } from "./helpers.ts";

const dirs: string[] = [];
const temp = (name: string) => {
  const dir = mkdtempSync(join(tmpdir(), `zuri-${name}-`));
  dirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const WORKSPACES = workspacesOf(readText("package.json"));
const rootPackage = () => readText("package.json");

/** The repository's own version files as the release pull request leaves them: written by writeVersion itself. */
function release(version: string): { file: string; base: string; head: string }[] {
  const dir = temp("release");
  const files = versionFiles(ROOT);
  for (const file of files) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    cpSync(join(ROOT, file), join(dir, file));
  }
  writeVersion(dir, version);
  return files.map((file) => ({ file, base: readText(file), head: readFileSync(join(dir, file), "utf8") }));
}

const change = (path: string, base: string | null = null, head: string | null = null): Change => ({ path, read: () => ({ base, head }) });

describe("isTextOnly", () => {
  it.each([
    "docs/especificacao.md",
    "docs/capturas/pr/agenda/agenda-celular-claro.png",
    "docs/planos/modelos-frontend/prototipo-interativo.html",
    "changelog/nao-lancado/agenda.md",
    "CHANGELOG.md",
    "README.md",
    "AGENTS.md",
    "CLAUDE.md",
    "CONTRIBUTING.md",
    "SECURITY.md",
    "NOTICE.md",
    "LICENSE",
    ".claude/memoria/progresso.md",
    ".claude/rules/web-ui.md",
  ])("takes %s for text", (path) => {
    expect(isTextOnly(path)).toBe(true);
  });

  it.each([
    "apps/web/src/App.tsx",
    "apps/web/index.html",
    "apps/web/README.md",
    "apps/web/docs/nota.md",
    "apps/agent/src/index.ts",
    "apps/agent/wrangler.jsonc",
    "packages/shared/i18n/pt-BR.ts",
    "packages/shared/src/version.ts",
    "tests/e2e/a11y.spec.ts",
    "tests/e2e/worker.env",
    "tests/lighthouse/lighthouse.spec.ts",
    "tests/repo/workflows.test.ts",
    "playwright.config.ts",
    "playwright.lighthouse.config.ts",
    "package.json",
    "package-lock.json",
    ".nvmrc",
    "biome.json",
    "tsconfig.base.json",
    "scripts/precisa-de-e2e.ts",
    ".github/workflows/ci.yml",
    ".github/dependabot.yml",
    // Lookalikes of the text folders.
    "docsx/a.md",
    "docs",
    "changelogs/a.md",
    ".claudex/a.md",
    "CHANGELOG.md/a.ts",
    "LICENSE.ts",
    "changelog.ts",
  ])("does not take %s for text", (path) => {
    expect(isTextOnly(path)).toBe(false);
  });
});

describe("onlyVersionChanged", () => {
  it("accepts every file exactly as writeVersion leaves it", () => {
    const files = release("98.76.54");
    expect(files.map((f) => f.file).sort()).toEqual(versionFilesOf(WORKSPACES).sort());
    for (const { file, base, head } of files) {
      expect(head, file).not.toBe(base);
      expect(onlyVersionChanged(file, base, head, WORKSPACES), file).toBe(true);
    }
  });

  it("refuses a package.json where anything else changed with the version", () => {
    const base = readText("package.json");
    const json = JSON.parse(base);
    const write = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;
    const bumped = { ...json, version: "98.76.54" };
    expect(onlyVersionChanged("package.json", base, write(bumped), WORKSPACES)).toBe(true);
    const cases: Record<string, string> = {
      "a script": write({ ...bumped, scripts: { ...json.scripts, "test:e2e": "true" } }),
      "a dependency": write({ ...bumped, devDependencies: { ...json.devDependencies, "@playwright/test": "1.0.0" } }),
      "a new key": write({ ...bumped, postinstall: "x" }),
      "a removed key": write({ ...bumped, overrides: undefined }),
      "another indentation": `${JSON.stringify(bumped, null, 4)}\n`,
      "no final newline": JSON.stringify(bumped, null, 2),
      "a version that is not x.y.z": write({ ...json, version: "98.76.54-beta" }),
      "a version that is not text": write({ ...json, version: 98 }),
      "not JSON": "{",
      "not an object": "[]\n",
    };
    for (const [what, head] of Object.entries(cases)) expect(onlyVersionChanged("package.json", base, head, WORKSPACES), what).toBe(false);
  });

  it("refuses a lockfile where a dependency moved", () => {
    const base = readText(LOCK_FILE);
    const head = release("98.76.54").find((f) => f.file === LOCK_FILE)?.head ?? "";
    const lock = JSON.parse(head);
    const dependency = Object.keys(lock.packages).find((name) => name.startsWith("node_modules/")) as string;
    lock.packages[dependency].version = "0.0.1";
    expect(onlyVersionChanged(LOCK_FILE, base, `${JSON.stringify(lock, null, 2)}\n`, WORKSPACES)).toBe(false);
    // A workspace the base does not list is a dependency like any other.
    expect(onlyVersionChanged(LOCK_FILE, base, head, [])).toBe(false);
    expect(onlyVersionChanged(LOCK_FILE, base, "{}\n", WORKSPACES)).toBe(false);
  });

  it("refuses a version.ts with anything but the number changed", () => {
    const base = readText(VERSION_FILE);
    const head = base.replace(/APP_VERSION = "[^"]*"/, 'APP_VERSION = "98.76.54"');
    expect(onlyVersionChanged(VERSION_FILE, base, head, WORKSPACES)).toBe(true);
    expect(onlyVersionChanged(VERSION_FILE, base, `${head}export const DEBUG = true;\n`, WORKSPACES)).toBe(false);
    expect(onlyVersionChanged(VERSION_FILE, base, head.replace("98.76.54", '98.76.54"; fetch("x'), WORKSPACES)).toBe(false);
    expect(onlyVersionChanged(VERSION_FILE, base, head.replace("98.76.54", "v98"), WORKSPACES)).toBe(false);
    expect(onlyVersionChanged(VERSION_FILE, "export const OTHER = 1;\n", head, WORKSPACES)).toBe(false);
  });

  it("refuses any file that does not carry the version of the system", () => {
    const base = '{\n  "version": "1.0.0"\n}\n';
    const head = '{\n  "version": "1.0.1"\n}\n';
    expect(onlyVersionChanged("apps/web/public/manifest.json", base, head, WORKSPACES)).toBe(false);
    expect(onlyVersionChanged("apps/outro/package.json", base, head, WORKSPACES)).toBe(false);
    expect(onlyVersionChanged("apps/web/package.json", base, head, WORKSPACES)).toBe(true);
    expect(onlyVersionChanged("apps/web/package.json", '{\n  "name": "x"\n}\n', '{\n  "name": "x",\n  "version": "1.0.1"\n}\n', WORKSPACES)).toBe(false);
  });
});

describe("decide", () => {
  const releaseChanges = () => release("98.76.54").map((f) => change(f.file, f.base, f.head));

  it("skips the browsers for text alone", () => {
    const decision = decide([change("docs/planos/agenda.md"), change("changelog/nao-lancado/agenda.md"), change("README.md")], rootPackage);
    expect(decision.run).toBe(false);
    expect(decision.reason).toContain("só texto");
  });

  it("skips the browsers for the release pull request: the changelog and the version number", () => {
    const decision = decide([change("CHANGELOG.md"), change("changelog/nao-lancado/agenda.md"), ...releaseChanges()], rootPackage);
    expect(decision).toEqual({ run: false, reason: expect.stringContaining("número da versão") });
  });

  it("runs them when one file among the text is anything else", () => {
    const decision = decide([change("docs/a.md"), ...releaseChanges(), change("apps/web/src/App.tsx", "a", "b")], rootPackage);
    expect(decision).toEqual({ run: true, reason: "a PR muda `apps/web/src/App.tsx`" });
  });

  it("runs them when a version file carries more than the version, is new or is gone", () => {
    const base = readText("package.json");
    const more = `${JSON.stringify({ ...JSON.parse(base), version: "98.76.54", type: "commonjs" }, null, 2)}\n`;
    expect(decide([change("package.json", base, more)], rootPackage).run).toBe(true);
    expect(decide([change("package.json", null, base)], rootPackage).run).toBe(true);
    expect(decide([change("package.json", base, null)], rootPackage).run).toBe(true);
    // Without a package.json on the base nothing counts as a version file.
    expect(decide(releaseChanges(), () => null).run).toBe(true);
  });

  it("runs them when it finds no file at all", () => {
    expect(decide([], rootPackage)).toEqual({ run: true, reason: "nenhum arquivo alterado encontrado" });
  });

  it("never reads a file that is text or outside the version files", () => {
    const read = () => {
      throw new Error("read");
    };
    expect(decide([{ path: "docs/a.md", read }, { path: "apps/web/src/a.png", read }], rootPackage).run).toBe(true);
  });

  it("shows at most ten files, with nothing that could mention or break the summary", () => {
    const many = Array.from({ length: 12 }, (_, i) => change(`apps/a${i}.ts`));
    expect(decide(many, rootPackage).reason).toMatch(/`apps\/a9\.ts` e mais 2$/);
    expect(decide([change("apps/`@dono`\n.ts")], rootPackage).reason).toBe("a PR muda `apps/__dono__.ts`");
  });
});

describe("decideFromCheckout", () => {
  /** A repository with a base commit and a pull request's merge commit in HEAD, as actions/checkout leaves it. */
  function checkout(pullRequest: (dir: string, git: (...args: string[]) => string) => void, merge = true) {
    const dir = temp("checkout");
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@exemplo.com.br", "-c", "commit.gpgsign=false", ...args], { cwd: dir, encoding: "utf8" });
    const write = (path: string, text: string) => {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    };
    git("init", "-q", "-b", "develop");
    write("package.json", '{\n  "name": "zuri",\n  "version": "1.0.0",\n  "workspaces": [\n    "apps/web"\n  ]\n}\n');
    write("apps/web/package.json", '{\n  "name": "web",\n  "version": "1.0.0"\n}\n');
    write("apps/web/src/a.ts", "export const a = 1;\n");
    write("docs/a.md", "a\n");
    git("add", "-A");
    git("commit", "-q", "-m", "base");
    git("checkout", "-q", "-b", "pr");
    pullRequest(dir, git);
    git("add", "-A");
    git("commit", "-q", "--allow-empty", "-m", "pr");
    if (merge) {
      git("checkout", "-q", "develop");
      git("merge", "-q", "--no-ff", "-m", "merge", "pr");
    }
    return (args: string[]) => git(...args);
  }
  const edit = (path: string, text: string) => (dir: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };

  it("skips the browsers for a pull request with only documentation", () => {
    expect(decideFromCheckout("pull_request", "develop", checkout(edit("docs/b.md", "b\n"))).run).toBe(false);
  });

  it("skips them for a pull request with only the version number", () => {
    const exec = checkout((dir) => {
      edit("package.json", '{\n  "name": "zuri",\n  "version": "1.0.1",\n  "workspaces": [\n    "apps/web"\n  ]\n}\n')(dir);
      edit("apps/web/package.json", '{\n  "name": "web",\n  "version": "1.0.1"\n}\n')(dir);
      edit("CHANGELOG.md", "# Changelog\n")(dir);
    });
    expect(decideFromCheckout("pull_request", "develop", exec).run).toBe(false);
  });

  it("runs them when the pull request names a workspace of its own to pass for a version file", () => {
    const exec = checkout((dir) => {
      edit("package.json", '{\n  "name": "zuri",\n  "version": "1.0.1",\n  "workspaces": [\n    "apps/web",\n    "apps/x"\n  ]\n}\n')(dir);
    });
    expect(decideFromCheckout("pull_request", "develop", exec)).toEqual({ run: true, reason: "a PR muda `package.json`" });
  });

  it("runs them for code, even beside documentation", () => {
    const exec = checkout((dir) => {
      edit("docs/b.md", "b\n")(dir);
      edit("apps/web/src/a.ts", "export const a = 2;\n")(dir);
    });
    expect(decideFromCheckout("pull_request", "develop", exec)).toEqual({ run: true, reason: "a PR muda `apps/web/src/a.ts`" });
  });

  it("runs them when code is moved into the documentation or removed", () => {
    const moved = checkout((_dir, git) => git("mv", "apps/web/src/a.ts", "docs/a.ts"));
    expect(decideFromCheckout("pull_request", "develop", moved)).toEqual({ run: true, reason: "a PR muda `apps/web/src/a.ts`" });
    const removed = checkout((_dir, git) => git("rm", "-q", "apps/web/package.json"));
    expect(decideFromCheckout("pull_request", "develop", removed).run).toBe(true);
  });

  it("runs them for an empty pull request and when HEAD is not a merge commit", () => {
    expect(decideFromCheckout("pull_request", "develop", checkout(() => {}))).toEqual({ run: true, reason: "nenhum arquivo alterado encontrado" });
    expect(decideFromCheckout("pull_request", "develop", checkout(edit("docs/b.md", "b\n"), false))).toEqual({ run: true, reason: "HEAD não é o commit de merge da PR" });
  });

  it("runs them for a pull request into any branch but develop and main, without reading anything", () => {
    const exec = () => {
      throw new Error("no git");
    };
    // Its green check would follow the head commit if the base were changed to develop later.
    expect(decideFromCheckout("pull_request", "feat/etapa-99-x", exec)).toEqual({ run: true, reason: "a base da PR é outra branch: sempre roda" });
    expect(decideFromCheckout("pull_request", "", exec)).toEqual({ run: true, reason: "a base da PR é desconhecida: sempre roda" });
    expect(decideFromCheckout("pull_request", "refs/heads/develop", exec).run).toBe(true);
    const docs = checkout(edit("docs/b.md", "b\n"));
    expect(decideFromCheckout("pull_request", "main", docs).run).toBe(false);
    expect(decideFromCheckout("pull_request", "develop2", docs).run).toBe(true);
  });

  it("runs them when a version file changes mode or becomes a symlink, even with the expected text", () => {
    const next = '{\n  "name": "web",\n  "version": "1.0.1"\n}\n';
    const executable = checkout((dir) => {
      edit("apps/web/package.json", next)(dir);
      chmodSync(join(dir, "apps/web/package.json"), 0o755);
    });
    expect(decideFromCheckout("pull_request", "develop", executable)).toEqual({ run: true, reason: "a PR muda `apps/web/package.json`" });
    const link = checkout((dir) => {
      rmSync(join(dir, "apps/web/package.json"));
      symlinkSync(next, join(dir, "apps/web/package.json"));
    });
    expect(decideFromCheckout("pull_request", "develop", link).run).toBe(true);
    // The same change as a plain file is only the version.
    expect(decideFromCheckout("pull_request", "develop", checkout(edit("apps/web/package.json", next))).run).toBe(false);
  });

  it("reads names with spaces, quotes and line breaks whole", () => {
    const odd = checkout(edit('docs/a "b"\n c.md', "x\n"));
    expect(decideFromCheckout("pull_request", "develop", odd).run).toBe(false);
    const code = checkout(edit("apps/web/src/a\nb é.ts", "x\n"));
    expect(decideFromCheckout("pull_request", "develop", code)).toEqual({ run: true, reason: "a PR muda `apps/web/src/a_b é.ts`" });
  });

  it("always runs them outside a pull request, without reading anything", () => {
    const exec = () => {
      throw new Error("no git");
    };
    expect(decideFromCheckout("push", "", exec)).toEqual({ run: true, reason: "evento push: sempre roda" });
    expect(decideFromCheckout("workflow_dispatch", "develop", exec).run).toBe(true);
    expect(decideFromCheckout("", "develop", exec)).toEqual({ run: true, reason: "evento desconhecido: sempre roda" });
  });

  it("imports nothing that needs npm ci: the step runs before it", () => {
    for (const file of ["scripts/precisa-de-e2e.ts", "scripts/versao.ts", "scripts/changelog.ts"]) {
      const imports = [...readText(file).matchAll(/from "([^"]+)"/g)].map((match) => match[1] as string);
      expect(imports.filter((name) => !name.startsWith("node:") && !name.startsWith("./")), file).toEqual([]);
    }
  });

  it("runs them when git fails", () => {
    const decision = decideFromCheckout("pull_request", "develop", () => {
      throw new Error("fatal: not a git repository\nmore");
    });
    expect(decision).toEqual({ run: true, reason: "não deu para ler as mudanças (fatal: not a git repository)" });
  });
});

describe("the browser jobs of ci.yml", () => {
  const ci = loadWorkflow(".github/workflows/ci.yml");
  const GUARD = "steps.browser.outputs.run != 'false'";

  it.each([
    ["e2e-parte", "npm run test:e2e -- --shard=${{ matrix.parte }}/4"],
    ["lighthouse", "npm run test:lighthouse"],
  ])("%s asks the script first and runs everything unless it said false", (name, command) => {
    const steps = ci.jobs[name]?.steps ?? [];
    // Two commits: the merge commit and its parents, which the script compares.
    expect(steps[0]?.with).toEqual({ "persist-credentials": false, "fetch-depth": 2 });
    const at = steps.findIndex((step) => step.id === "browser");
    expect(at).toBeGreaterThan(0);
    // The decision itself always runs, and a failure in it fails the job.
    expect(steps.slice(0, at + 1).every((step) => step.if === undefined && step["continue-on-error"] === undefined)).toBe(true);
    expect(steps[at]).toEqual({
      id: "browser",
      run: "node scripts/precisa-de-e2e.ts",
      env: { EVENT_NAME: "${{ github.event_name }}", BASE_REF: "${{ github.base_ref }}" },
    });
    const after = steps.slice(at + 1);
    expect(after.map((step) => step.run)).toEqual(["npm ci", "npx playwright install --with-deps chromium", command]);
    // Anything but an explicit "false" (an empty output included) runs the suite.
    for (const step of after) expect(step.if).toBe(GUARD);
  });

  it("runs the e2e suite in parts that cover it whole, each one reporting", () => {
    const parts = ci.jobs["e2e-parte"];
    const numbers = parts?.strategy?.matrix?.parte ?? [];
    // 1 to N over the same N as the command: a part left out of the matrix would be tests nobody ran.
    expect(numbers).toEqual([1, 2, 3, 4]);
    expect(parts?.steps?.at(-1)?.run).toMatch(new RegExp(`--shard=\\$\\{\\{ matrix\\.parte \\}\\}/${numbers.length}$`));
    expect(Object.keys(parts?.strategy?.matrix ?? {})).toEqual(["parte"]);
    expect(parts?.strategy?.["fail-fast"]).toBe(false);
    // Splitting is what keeps the suite inside the limit, never a longer limit.
    expect(parts?.["timeout-minutes"]).toBeLessThanOrEqual(30);
  });

  it("keeps the required e2e check green only when every part succeeded", () => {
    const e2e = ci.jobs.e2e;
    expect(e2e?.needs).toBe("e2e-parte");
    // always(): a failed or cancelled part must not leave the required check "skipped".
    expect(e2e?.if).toBe("${{ always() }}");
    expect(e2e?.steps).toEqual([
      {
        name: "Every part of the e2e suite passed",
        env: { RESULT: "${{ needs.e2e-parte.result }}" },
        run: 'echo "e2e-parte: $RESULT"\ntest "$RESULT" = "success"\n',
      },
    ]);
    // The same line, run: only "success" passes.
    const verdict = (result: string) => {
      try {
        execFileSync("bash", ["-e", "-c", e2e?.steps?.[0]?.run ?? "false"], { env: { ...process.env, RESULT: result }, stdio: "ignore" });
        return "pass";
      } catch {
        return "fail";
      }
    };
    expect(verdict("success")).toBe("pass");
    for (const result of ["failure", "cancelled", "skipped", "", "success\nx", " success"]) expect(verdict(result), JSON.stringify(result)).toBe("fail");
  });

  it("is the only place where CI skips anything", () => {
    for (const [name, job] of Object.entries(ci.jobs)) {
      expect(job["continue-on-error"], name).toBeUndefined();
      for (const step of job.steps ?? []) {
        expect(step["continue-on-error"], name).toBeUndefined();
        if (name !== "e2e-parte" && name !== "lighthouse") expect(step.if, name).toBeUndefined();
      }
      // A job skipped by `if`, or by a failed job it needs, reports "skipped", which the rulesets take for a pass.
      // Only the e2e check depends on other jobs, and it always runs (the test above).
      if (name === "e2e") continue;
      expect(job.if, name).toBeUndefined();
      expect(job.needs, name).toBeUndefined();
    }
  });
});
