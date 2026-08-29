import crypto from "node:crypto";

import { prisma } from "@/lib/prisma";

function hashKey(value: string) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function getRequestClientAddress(headers: Headers) {
  // Railway supplies this header from its edge proxy. It is deliberately used
  // only as one component of a rate-limit key, never for authorization.
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip")?.trim() ||
    "unknown"
  );
}

export function buildSecurityRateLimitKey(params: {
  clientAddress: string;
  namespace: string;
  subject?: string | null;
}) {
  return hashKey(
    [params.namespace, params.clientAddress.trim(), params.subject?.trim().toLowerCase() ?? ""]
      .join("\u0000"),
  );
}

export async function consumeSecurityRateLimit(params: {
  clientAddress: string;
  limit: number;
  namespace: string;
  subject?: string | null;
  windowMs: number;
}) {
  const key = buildSecurityRateLimitKey(params);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + params.windowMs);

  return prisma.$transaction(async (tx) => {
    const existing = await tx.securityRateLimit.findUnique({
      where: { key },
      select: { count: true, expiresAt: true },
    });

    if (!existing || existing.expiresAt <= now) {
      await tx.securityRateLimit.upsert({
        where: { key },
        create: { key, count: 1, expiresAt },
        update: { count: 1, expiresAt },
      });
      return { allowed: true, retryAfterSeconds: 0 } as const;
    }

    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((existing.expiresAt.getTime() - now.getTime()) / 1000),
    );

    if (existing.count >= params.limit) {
      return { allowed: false, retryAfterSeconds } as const;
    }

    await tx.securityRateLimit.update({
      where: { key },
      data: { count: { increment: 1 } },
    });
    return { allowed: true, retryAfterSeconds: 0 } as const;
  });
}

export async function clearSecurityRateLimit(params: {
  clientAddress: string;
  namespace: string;
  subject?: string | null;
}) {
  const key = buildSecurityRateLimitKey(params);
  await prisma.securityRateLimit.delete({ where: { key } }).catch(() => undefined);
}
