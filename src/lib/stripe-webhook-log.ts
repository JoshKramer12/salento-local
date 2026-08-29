import { Prisma, StripeWebhookEndpointType } from "@prisma/client";

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

  if (existing) {
    return {
      alreadyProcessed: true,
      id: existing.id,
      status: existing.status,
    };
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
