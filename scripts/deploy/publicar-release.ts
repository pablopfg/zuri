// Runs in deploy.yml after a deploy of main that passed its checks
// (docs/agente/versionamento.md, "Release na main"):
//
//   node scripts/deploy/publicar-release.ts
//
// The version on main is the newest section of its CHANGELOG.md. Its tag and its
// pre-release already exist (versao.yml makes them when the merge lands on
// develop), so publishing is turning that pre-release into the full release,
// marked "Latest", with the same notes in pt-BR and the line that says it went
// out. It never creates or moves a tag: a tag missing or not in main's history
// stops the run for a person to look.
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, tryRun } from "../atualizar-prs.ts";
import { parseChangelog, releaseName, releaseNotes, type Version } from "../versao.ts";

export interface PublishPlan {
  tag: string;
  title: string;
  notes: string;
}

/** What to publish for the CHANGELOG.md of main, or the reason it can't be. */
export function planPublish(
  changelog: string,
  inHistory: (tag: string) => boolean,
): { ok: true; plan: PublishPlan } | { ok: false; error: string } {
  const versions = parseChangelog(changelog).versions;
  const current: Version | undefined = versions[0];
  if (!current) return { ok: false, error: "CHANGELOG.md has no version yet" };
  const tag = `v${current.version}`;
  if (!inHistory(tag)) return { ok: false, error: `tag ${tag} is missing or not in the history of main; run the Versão workflow on develop first` };
  return { ok: true, plan: { tag, title: releaseName(current), notes: releaseNotes(current, versions[1] ?? null, true) } };
}

if (import.meta.main) {
  const root = join(import.meta.dirname, "..", "..");
  const repository = process.env.GITHUB_REPOSITORY ?? "";
  const git = (args: string[]) => run("git", args, { cwd: root });
  const planned = planPublish(readFileSync(join(root, "CHANGELOG.md"), "utf8"), (tag) => {
    const commit = tryRun(() => git(["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`]));
    return commit.ok && tryRun(() => git(["merge-base", "--is-ancestor", commit.out.trim(), "HEAD"])).ok;
  });
  if (!planned.ok) {
    console.log(`::error::${planned.error}`);
    process.exit(1);
  }
  const { tag, title, notes } = planned.plan;
  const dir = mkdtempSync(join(tmpdir(), "release-"));
  const file = join(dir, "notes.md");
  writeFileSync(file, notes);
  const edited = tryRun(() =>
    run("gh", ["release", "edit", tag, "--repo", repository, "--title", title, "--prerelease=false", "--latest", "--notes-file", file], { cwd: root }),
  );
  rmSync(dir, { recursive: true, force: true });
  if (!edited.ok) {
    console.log(`::error::release ${tag} not published: ${edited.out.trim().split("\n").at(-1)}`);
    process.exit(1);
  }
  console.log(`release ${tag} published as the latest version`);
}
