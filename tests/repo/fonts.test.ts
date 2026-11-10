import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The interface's font files are binaries copied once from a package (apps/web/src/fonts/ORIGEM.md).
// A diff only says "binary files differ": these digests make a swapped file fail here.
const FONTS = join(import.meta.dirname, "../../apps/web/src/fonts");
const DIGESTS: Record<string, string> = {
  "figtree-latin-wght-normal.woff2": "4ba7d3d096695818fe0686be4f1e82c6b05134e18a22260336130335027462dd",
  "figtree-latin-ext-wght-normal.woff2": "bf7828e2c258cffcfa50a048ee388a36b95bc16b452e8d36fa797635dbe15965",
};

describe("the interface's font files", () => {
  it("are exactly the ones recorded, with the license and the origin beside them", () => {
    const files = readdirSync(FONTS).sort();
    expect(files).toEqual(["LICENSE-Figtree.txt", "ORIGEM.md", ...Object.keys(DIGESTS)].sort());
    for (const [name, digest] of Object.entries(DIGESTS)) {
      expect(createHash("sha256").update(readFileSync(join(FONTS, name))).digest("hex"), name).toBe(digest);
    }
    const origin = readFileSync(join(FONTS, "ORIGEM.md"), "utf8");
    for (const digest of Object.values(DIGESTS)) expect(origin).toContain(digest);
    expect(readFileSync(join(FONTS, "LICENSE-Figtree.txt"), "utf8")).toContain("SIL Open Font License");
  });
});
