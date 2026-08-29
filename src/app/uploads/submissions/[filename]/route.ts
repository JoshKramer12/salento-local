import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const runtime = "nodejs";

function getSubmissionUploadCandidates(filename: string) {
  const runtimeStorageRoot =
    process.env.NODE_ENV === "production"
      ? "/data"
      : path.join(process.cwd(), ".data");

  return [
    path.join(runtimeStorageRoot, "uploads", "submissions", filename),
    path.join(process.cwd(), "public", "uploads", "submissions", filename),
  ];
}

function getContentType(filename: string) {
  const extension = path.extname(filename).toLowerCase();

  switch (extension) {
    case ".png":
      return "image/png";
    case ".webp":
      return "image/webp";
    case ".gif":
      return "image/gif";
    case ".svg":
      return "image/svg+xml";
    case ".jpeg":
    case ".jpg":
    default:
      return "image/jpeg";
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ filename: string }> },
) {
  const { filename } = await context.params;

  if (!filename || filename.includes("/") || filename.includes("\\")) {
    return new NextResponse("Not found", { status: 404 });
  }

  for (const filePath of getSubmissionUploadCandidates(filename)) {
    try {
      const file = await readFile(filePath);

      return new NextResponse(file, {
        headers: {
          "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
          "Content-Security-Policy": "sandbox; default-src 'none'",
          "Content-Type": getContentType(filename),
          "X-Content-Type-Options": "nosniff",
        },
        status: 200,
      });
    } catch {
      continue;
    }
  }

  return new NextResponse("Not found", { status: 404 });
}
