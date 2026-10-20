import { randomUUID } from "node:crypto";

export function resolvePublishNewIntent({
  adminMode,
  requestedNewIntentId,
  skipPayoutSetup,
  submissionId,
}: {
  adminMode: boolean;
  requestedNewIntentId?: string;
  skipPayoutSetup: boolean;
  submissionId?: string;
}) {
  if (submissionId) return { newIntentId: null, redirectHref: null };

  if (requestedNewIntentId && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(requestedNewIntentId)) {
    return { newIntentId: requestedNewIntentId, redirectHref: null };
  }

  const params = new URLSearchParams();
  if (adminMode) params.set("mode", "admin");
  if (skipPayoutSetup) params.set("skipPayoutSetup", "1");
  params.set("new", randomUUID());
  return { newIntentId: null, redirectHref: `/publish?${params.toString()}` };
}
