import {
  consumeSecurityRateLimit,
  getRequestClientAddress,
} from "@/lib/security-rate-limit";

/** Durable protection for anonymous write endpoints across restarts/instances. */
export async function runThrottledPublicWrite<T>(params: {
  minIntervalMs: number;
  request: Request;
  task: () => Promise<T>;
  taskName: string;
}) {
  const rateLimit = await consumeSecurityRateLimit({
    clientAddress: getRequestClientAddress(params.request.headers),
    limit: 1,
    namespace: params.taskName,
    windowMs: params.minIntervalMs,
  });

  if (!rateLimit.allowed) {
    return null;
  }

  return params.task();
}
