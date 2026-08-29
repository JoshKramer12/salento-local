import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { createPartnerOnboardingAccountSession } from "@/lib/partner-connect";
import { prisma } from "@/lib/prisma";
import { hasSameOriginOrNoOrigin } from "@/lib/request-security";

export async function POST(request: Request) {
  if (!hasSameOriginOrNoOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const session = await auth();
  const viewer = session?.user;

  if (!viewer?.id || viewer.role !== "GETTER") {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const profile = await prisma.localPartnerProfile.findUnique({
    where: {
      userId: viewer.id,
    },
    select: {
      completedAt: true,
    },
  });

  if (!profile?.completedAt) {
    return NextResponse.json({ error: "partner_profile_incomplete" }, { status: 400 });
  }

  const accountSession = await createPartnerOnboardingAccountSession(viewer.id);

  return NextResponse.json({
    clientSecret: accountSession.clientSecret,
  });
}
