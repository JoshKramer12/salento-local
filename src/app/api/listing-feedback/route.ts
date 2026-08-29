import { ListingFeedbackType } from "@prisma/client";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/prisma";
import { runThrottledPublicWrite } from "@/lib/public-write-throttle";

function readTrimmedString(value: unknown, maxLength: number) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

export async function POST(request: Request) {
  try {
    const response = await runThrottledPublicWrite({
      minIntervalMs: 30_000,
      request,
      taskName: "public-listing-feedback",
      task: async () => {
        const payload = (await request.json()) as Record<string, unknown>;
        const businessId = readTrimmedString(payload.businessId, 80);
        const type = readTrimmedString(payload.type, 40);
        const senderName = readTrimmedString(payload.senderName, 80);
        const senderEmail = readTrimmedString(payload.senderEmail, 120);
        const message = readTrimmedString(payload.message, 2000);

        if (!businessId || !message) {
          return NextResponse.json({ error: "Business and message are required." }, { status: 400 });
        }

        const isValidType = Object.values(ListingFeedbackType).includes(type as ListingFeedbackType);

        if (!isValidType) return NextResponse.json({ error: "Invalid feedback type." }, { status: 400 });

        const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });

        if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

        const feedback = await prisma.listingFeedback.create({
          data: {
            businessId,
            type: type as ListingFeedbackType,
            senderName: senderName || null,
            senderEmail: senderEmail || null,
            message,
          },
        });

        return NextResponse.json({ ok: true, feedbackId: feedback.id });
      },
    });

    return response ?? NextResponse.json(
      { error: "Please wait before sending another update." },
      { status: 429 },
    );
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Unable to save your update right now." },
      { status: 500 },
    );
  }
}
