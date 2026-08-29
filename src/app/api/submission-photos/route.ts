import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { NextResponse } from "next/server";

import { auth } from "@/lib/auth";
import { hasSameOriginOrNoOrigin } from "@/lib/request-security";
import {
  consumeSecurityRateLimit,
  getRequestClientAddress,
} from "@/lib/security-rate-limit";

export const runtime = "nodejs";

const acceptedImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

function getSubmissionUploadDirectory() {
  const storageRoot =
    process.env.NODE_ENV === "production"
      ? "/data"
      : path.join(process.cwd(), ".data");

  return path.join(storageRoot, "uploads", "submissions");
}

function extensionFromType(type: string) {
  return type === "image/png" ? ".png" : type === "image/webp" ? ".webp" : ".jpg";
}

function hasExpectedImageSignature(buffer: Buffer, type: string) {
  if (type === "image/jpeg") {
    return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  }

  if (type === "image/png") {
    return buffer.length >= 8 && buffer.subarray(0, 8).equals(
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    );
  }

  return buffer.length >= 12 && buffer.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    buffer.subarray(8, 12).equals(Buffer.from("WEBP"));
}

function normalizeSlot(value: FormDataEntryValue | null) {
  if (typeof value !== "string") return "photo";

  const normalized = value.trim().toLowerCase();
  return /^[a-z0-9_-]{1,40}$/.test(normalized) ? normalized : "photo";
}

export async function POST(request: Request) {
  if (!hasSameOriginOrNoOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const session = await auth();

  if (!session?.user?.id || !session.user.profileCompleted) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const rateLimit = await consumeSecurityRateLimit({
    clientAddress: getRequestClientAddress(request.headers),
    limit: 30,
    namespace: "submission-photo-upload",
    subject: session.user.id,
    windowMs: 60 * 60 * 1000,
  });

  if (!rateLimit.allowed) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  const slot = normalizeSlot(formData.get("slot"));

  if (!(file instanceof File) || !acceptedImageTypes.has(file.type)) {
    return NextResponse.json({ error: "invalid_file" }, { status: 400 });
  }

  if (file.size > 10 * 1024 * 1024) {
    return NextResponse.json({ error: "file_too_large" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  if (!hasExpectedImageSignature(buffer, file.type)) {
    return NextResponse.json({ error: "invalid_file" }, { status: 400 });
  }
  const uploadDir = getSubmissionUploadDirectory();
  await mkdir(uploadDir, { recursive: true });

  const filename = `${slot}-${Date.now()}-${randomUUID()}${extensionFromType(file.type)}`;
  const outputPath = path.join(uploadDir, filename);
  await writeFile(outputPath, buffer);

  return NextResponse.json({
    url: `/uploads/submissions/${filename}`,
  });
}
