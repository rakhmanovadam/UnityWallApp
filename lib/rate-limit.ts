import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { serverEnv } from "@/lib/env";

type Bucket =
  | "otp"
  | "otp_email"
  | "leads"
  | "applications"
  | "uploads"
  | "public_read";

const RULES: Record<Bucket, { tokens: number; window: string }> = {
  otp: { tokens: 10, window: "60 s" },
  otp_email: { tokens: 3, window: "900 s" },
  leads: { tokens: 5, window: "60 s" },
  applications: { tokens: 5, window: "60 s" },
  uploads: { tokens: 60, window: "60 s" },
  // Unauthenticated photo-list / signed-thumb GETs. Each call hits Storage and
  // mints a signed URL, so an unbounded caller is an enumeration/DoS amplifier.
  public_read: { tokens: 120, window: "60 s" },
};

let redis: Redis | null = null;
const limiters = new Map<Bucket, Ratelimit>();

function getRedis() {
  if (redis) return redis;
  const env = serverEnv();
  if (!env.UPSTASH_REDIS_REST_URL || !env.UPSTASH_REDIS_REST_TOKEN) return null;
  redis = new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return redis;
}

function getLimiter(bucket: Bucket): Ratelimit | null {
  const r = getRedis();
  if (!r) return null;
  const cached = limiters.get(bucket);
  if (cached) return cached;
  const rule = RULES[bucket];
  const limiter = new Ratelimit({
    redis: r,
    limiter: Ratelimit.slidingWindow(
      rule.tokens,
      rule.window as `${number} s`,
    ),
    analytics: false,
    prefix: `uw:${bucket}`,
  });
  limiters.set(bucket, limiter);
  return limiter;
}

// Returns { allowed: true } if Upstash isn't configured (dev fallback) or the
// request is under the limit. Returns { allowed: false, retryAfter } when the
// limit is exceeded.
export async function rateLimit(bucket: Bucket, key: string) {
  const limiter = getLimiter(bucket);
  if (!limiter) return { allowed: true as const };
  const { success, reset } = await limiter.limit(key);
  if (success) return { allowed: true as const };
  return {
    allowed: false as const,
    retryAfter: Math.max(0, Math.ceil((reset - Date.now()) / 1000)),
  };
}
