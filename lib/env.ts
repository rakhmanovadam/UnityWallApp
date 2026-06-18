import { z } from "zod";

// Client-safe env (inlined at build time via NEXT_PUBLIC_ prefix).
export const publicEnv = z
  .object({
    NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().optional(),
  })
  .parse({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });

// Server-only env. Importing this module from a client component will throw at
// build time because the referenced vars aren't in the public bundle.
export function serverEnv() {
  return z
    .object({
      SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
      SUPABASE_SECRET_KEY: z.string().optional(),
      RESEND_API_KEY: z.string().min(1),
      RESEND_FROM: z.string().min(1),
      ADMIN_NOTIFY_EMAIL: z.string().email(),
      GUEST_JWT_SECRET: z.string().min(32),
      APP_BASE_URL: z.string().url(),
      UPSTASH_REDIS_REST_URL: z.string().url().optional(),
      UPSTASH_REDIS_REST_TOKEN: z.string().optional(),
    })
    .parse({
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY,
      RESEND_API_KEY: process.env.RESEND_API_KEY,
      RESEND_FROM: process.env.RESEND_FROM,
      ADMIN_NOTIFY_EMAIL: process.env.ADMIN_NOTIFY_EMAIL,
      GUEST_JWT_SECRET: process.env.GUEST_JWT_SECRET,
      APP_BASE_URL: process.env.APP_BASE_URL,
      UPSTASH_REDIS_REST_URL: process.env.UPSTASH_REDIS_REST_URL,
      UPSTASH_REDIS_REST_TOKEN: process.env.UPSTASH_REDIS_REST_TOKEN,
    });
}
