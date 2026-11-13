// Before any schema here: the package is marked side-effect free, so index.ts alone can't order it.
import "./zod-config.ts";

import { z } from "zod";
import { CHATWOOT_LIMITS, FLOW_LIMITS } from "./flows.ts";
import { connectionOriginSchema } from "./flows-schemas.ts";

/** The bodies of the owner's Chatwoot routes (docs/planos/zuri-no-chatwoot.md). Server only. */
const adminKey = /* @__PURE__ */ (() =>
  z
    .string()
    .trim()
    .min(1)
    .max(FLOW_LIMITS.credential)
    .regex(/^[\x20-\x7e]+$/))();

const accountId = /* @__PURE__ */ (() => z.number().int().min(1).max(CHATWOOT_LIMITS.accountMax))();

/** "Esta conta é você?": the address, the account and the administrator's key, used for this request alone. */
export const chatwootOwnerCheckSchema = /* @__PURE__ */ (() => z.object({ origin: connectionOriginSchema, accountId, adminKey }).strict())();

/** The setup: the same, plus the account the owner said is theirs (it must still be the key's). */
export const chatwootOwnerSetupSchema = /* @__PURE__ */ (() =>
  z.object({ origin: connectionOriginSchema, accountId, adminKey, ownerId: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER) }).strict())();

/** The full test and the new secrets: the key again, for this request alone. */
export const chatwootOwnerKeySchema = /* @__PURE__ */ (() => z.object({ adminKey }).strict())();

/** Repair: the key again and, when the Chatwoot moved, its new address. */
export const chatwootOwnerRepairSchema = /* @__PURE__ */ (() => z.object({ adminKey, origin: connectionOriginSchema.optional() }).strict())();

/** The switch. */
export const chatwootOwnerUpdateSchema = /* @__PURE__ */ (() => z.object({ enabled: z.boolean() }).strict())();
