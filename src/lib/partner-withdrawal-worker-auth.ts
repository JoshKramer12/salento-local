import crypto from "node:crypto";

export function workerSecretAuthorized(request: Request, secret: string) {
  const provided = request.headers.get("authorization")?.replace(/^Bearer /, "").trim() ?? "";
  const left = Buffer.from(provided);
  const right = Buffer.from(secret);
  return Boolean(secret && provided && left.length === right.length && crypto.timingSafeEqual(left, right));
}
