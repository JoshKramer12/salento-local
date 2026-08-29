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
      taskName: "public-review",
      task: async () => {
        const payload = (await request.json()) as Record<string, unknown>;
        const businessId = readTrimmedString(payload.businessId, 80);
        const authorName = readTrimmedString(payload.authorName, 80);
        const title = readTrimmedString(payload.title, 140);
        const body = readTrimmedString(payload.body, 2000);
        const rating = Number(payload.rating);

        if (!businessId || !authorName || !title || !body) {
          return NextResponse.json({ error: "Please complete all review fields." }, { status: 400 });
        }

        if (!Number.isFinite(rating) || rating < 1 || rating > 5) {
          return NextResponse.json({ error: "Ratings must be between 1 and 5." }, { status: 400 });
        }

        const business = await prisma.business.findUnique({ where: { id: businessId }, select: { id: true } });

        if (!business) return NextResponse.json({ error: "Business not found." }, { status: 404 });

        const review = await prisma.review.create({ data: { businessId, authorName, title, body, rating } });

        const aggregate = await prisma.review.aggregate({
          where: { businessId },
          _avg: { rating: true },
          _count: { _all: true },
        });

        await prisma.business.update({
          where: { id: businessId },
          data: {
            rating: aggregate._avg.rating ?? 0,
            reviewCount: aggregate._count._all,
            lastVerifiedAt: new Date(),
          },
        });

        return NextResponse.json({ ok: true, reviewId: review.id });
      },
    });

    return response ?? NextResponse.json(
      { error: "Please wait before sending another review." },
      { status: 429 },
    );
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Unable to save your review right now." },
      { status: 500 },
    );
  }
}
