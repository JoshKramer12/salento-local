import { z } from "zod";
import { getTransactionalReplyTo } from "@/lib/email";
import { normalizeEnvValue } from "@/lib/env";

/** Reuse the configured business contact; never hardcode an operator address. */
export function getSupportContactEmail(env: NodeJS.ProcessEnv = process.env) {
  const configured = normalizeEnvValue(env.SUPPORT_EMAIL) || getTransactionalReplyTo(env);
  const address = (configured.match(/<([^>]+)>/)?.[1] || configured).trim();
  return z.string().email().safeParse(address).success ? address : null;
}
