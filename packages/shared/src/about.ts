// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z as mini } from "zod/mini";

/**
 * GET /api/version (PR S16): the version the server runs, for Settings > Sobre a Zuri to compare
 * with the screen's own. Only the number, never the deployment's id.
 */
export const serverVersionSchema = /* @__PURE__ */ mini.strictObject({
  version: mini.string().check(mini.regex(/^\d+\.\d+\.\d+$/)),
});

export type ServerVersion = mini.infer<typeof serverVersionSchema>;

/** Where "Ver todas as versões" and "Ver o código" lead (the repository is public). */
export const REPOSITORY_URL = "https://github.com/pablopfg/Zuri";
export const RELEASES_URL = `${REPOSITORY_URL}/releases`;
