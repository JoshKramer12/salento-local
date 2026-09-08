import {
  Prisma,
  StripeWebhookEndpointType,
  StripeWebhookProcessingStatus,
} from "@prisma/client";

import { prisma } from "@/lib/prisma";

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
  const existing = await prisma.stripeWebhookEvent.findUnique({
    where: {
      stripeEventId: params.stripeEventId,
    },
    select: {
      id: true,
      status: true,
    },
  });

  if (existing && !shouldRetryStripeWebhook(existing.status)) {
    return {
      alreadyProcessed: true,
      id: existing.id,
      status: existing.status,
    };
  }

  // A failed delivery must be retried. In particular, payment publication is
  // committed before transactional email is sent, so a temporary mail-provider
  // error must not make Stripe's retry of this event a permanent no-op.
  if (existing && shouldRetryStripeWebhook(existing.status)) {
    const resumed = await prisma.stripeWebhookEvent.updateMany({
      where: {
        id: existing.id,
        status: StripeWebhookProcessingStatus.FAILED,
      },
      data: {
        errorMessage: null,
        processedAt: null,
        status: StripeWebhookProcessingStatus.SKIPPED,
      },
    });

    if (resumed.count) {
      return {
        alreadyProcessed: false,
        id: existing.id,
        status: StripeWebhookProcessingStatus.SKIPPED,
      };
    }

    const concurrentEvent = await prisma.stripeWebhookEvent.findUnique({
      where: { stripeEventId: params.stripeEventId },
      select: { id: true, status: true },
    });

    if (concurrentEvent) {
      return {
        alreadyProcessed: true,
        id: concurrentEvent.id,
        status: concurrentEvent.status,
      };
    }
  }

  let event;

  try {
    event = await prisma.stripeWebhookEvent.create({
      data: {
        endpointType: params.endpointType,
        eventType: params.eventType,
        livemode: Boolean(params.livemode),
        status: "SKIPPED",
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
        select: { id: true, status: true },
      });

      if (concurrentEvent) {
        return {
          alreadyProcessed: true,
          id: concurrentEvent.id,
          status: concurrentEvent.status,
        };
      }
    }

    throw error;
  }

  return {
    alreadyProcessed: false,
    id: event.id,
    status: event.status,
  };
}

export async function completeStripeWebhookProcessing(params: {
  errorMessage?: string | null;
  id: string;
  status: "FAILED" | "PROCESSED" | "SKIPPED";
  summary?: Prisma.InputJsonValue;
}) {
  await prisma.stripeWebhookEvent.update({
    where: {
      id: params.id,
    },
    data: {
      errorMessage: params.errorMessage ?? null,
      processedAt: new Date(),
      status: params.status,
      summary: params.summary,
    },
  });
}
