import {
  Prisma,
  StripeWebhookEndpointType,
  StripeWebhookProcessingStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

// Stripe retries after a non-2xx response. A stale claim can also be taken
// over after a process dies between receiving and completing an event.
const PROCESSING_LEASE_MS = 10 * 60 * 1000;

type BeginWebhookParams = {
  endpointType: StripeWebhookEndpointType;
  eventType: string;
  livemode?: boolean;
  stripeAccountId?: string | null;
  stripeEventId: string;
  stripeObjectId?: string | null;
  summary?: Prisma.InputJsonValue;
};

export function shouldRetryStripeWebhook(
  status: StripeWebhookProcessingStatus,
) {
  return status === StripeWebhookProcessingStatus.FAILED;
}

export async function beginStripeWebhookProcessing(params: BeginWebhookParams) {
  const now = new Date();
  const existing = await prisma.stripeWebhookEvent.findUnique({
    where: {
      stripeEventId: params.stripeEventId,
    },
    select: {
      id: true,
      status: true,
      attemptCount: true,
      updatedAt: true,
    },
  });

  if (existing) {
    if (existing.status === StripeWebhookProcessingStatus.PROCESSED ||
      existing.status === StripeWebhookProcessingStatus.SKIPPED) {
      return { alreadyProcessed: true, inProgress: false, id: existing.id, attemptCount: existing.attemptCount };
    }
    const staleBefore = new Date(now.getTime() - PROCESSING_LEASE_MS);
    if (existing.status === StripeWebhookProcessingStatus.PROCESSING && existing.updatedAt > staleBefore) {
      return { alreadyProcessed: false, inProgress: true, id: existing.id, attemptCount: existing.attemptCount };
    }
    const resumed = await prisma.stripeWebhookEvent.updateMany({
      where: {
        id: existing.id,
        status: existing.status,
        attemptCount: existing.attemptCount,
        ...(existing.status === StripeWebhookProcessingStatus.PROCESSING ? { updatedAt: { lte: staleBefore } } : {}),
      },
      data: {
        errorMessage: null,
        processedAt: null,
        status: StripeWebhookProcessingStatus.PROCESSING,
        attemptCount: { increment: 1 },
      },
    });

    if (resumed.count) {
      return { alreadyProcessed: false, inProgress: false, id: existing.id, attemptCount: existing.attemptCount + 1 };
    }

    // A concurrent delivery won the claim. Do not acknowledge work that may
    // still fail; Stripe can retry after the winning attempt completes.
    return { alreadyProcessed: false, inProgress: true, id: existing.id, attemptCount: existing.attemptCount };
  }

  let event;

  try {
    event = await prisma.stripeWebhookEvent.create({
      data: {
        endpointType: params.endpointType,
        eventType: params.eventType,
        livemode: Boolean(params.livemode),
        status: "PROCESSING",
        attemptCount: 1,
        stripeAccountId: params.stripeAccountId ?? null,
        stripeEventId: params.stripeEventId,
        stripeObjectId: params.stripeObjectId ?? null,
        summary: params.summary,
      },
    });
  } catch (error) {
    // Concurrent deliveries can both pass the read above. The database's
    // unique index is the authority; turn that expected race into a duplicate.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const concurrentEvent = await prisma.stripeWebhookEvent.findUnique({
        where: { stripeEventId: params.stripeEventId },
        select: { id: true, status: true, attemptCount: true },
      });

      if (concurrentEvent) {
        return {
          alreadyProcessed: concurrentEvent.status === "PROCESSED" || concurrentEvent.status === "SKIPPED",
          inProgress: concurrentEvent.status !== "PROCESSED" && concurrentEvent.status !== "SKIPPED",
          id: concurrentEvent.id,
          attemptCount: concurrentEvent.attemptCount,
        };
      }
    }

    throw error;
  }

  return {
    alreadyProcessed: false,
    inProgress: false,
    id: event.id,
    attemptCount: event.attemptCount,
  };
}

export async function completeStripeWebhookProcessing(params: {
  errorMessage?: string | null;
  id: string;
  attemptCount: number;
  status: "FAILED" | "PROCESSED" | "SKIPPED";
  summary?: Prisma.InputJsonValue;
}) {
  const updated = await prisma.stripeWebhookEvent.updateMany({
    where: {
      id: params.id,
      status: "PROCESSING",
      attemptCount: params.attemptCount,
    },
    data: {
      errorMessage: params.errorMessage ?? null,
      processedAt: new Date(),
      status: params.status,
      summary: params.summary,
    },
  });
  if (updated.count !== 1) throw new Error("webhook_processing_lease_lost");
}
