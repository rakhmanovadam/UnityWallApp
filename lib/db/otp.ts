import { randomInt, createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";

const TTL_MINUTES = 10;
const MAX_ATTEMPTS = 5;

function generateCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function hashCode(code: string, salt: string) {
  return createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

// Codes are stored as "salt$hash". This keeps each OTP self-contained — no
// per-row column needed for the salt.
function pack(salt: string, hash: string) {
  return `${salt}$${hash}`;
}

function unpack(stored: string): { salt: string; hash: string } | null {
  const i = stored.indexOf("$");
  if (i <= 0) return null;
  return { salt: stored.slice(0, i), hash: stored.slice(i + 1) };
}

// Upserts the guest record (one row per event+email) and writes a fresh OTP.
// Returns the generated plaintext code for the caller to email out.
export async function issueOtp(opts: {
  eventId: string;
  email: string;
  marketingOptIn: boolean;
  consentTextVersion?: string;
}) {
  const admin = createAdminClient();

  const { data: guest, error: guestErr } = await admin
    .from("guests")
    .upsert(
      {
        event_id: opts.eventId,
        email: opts.email,
        marketing_opt_in: opts.marketingOptIn,
        consent_timestamp: opts.marketingOptIn ? new Date().toISOString() : null,
        consent_text_version: opts.consentTextVersion ?? "v1.0",
      },
      { onConflict: "event_id,email" },
    )
    .select("id")
    .single();

  if (guestErr || !guest) {
    throw new Error(`guest_upsert_failed: ${guestErr?.message ?? "unknown"}`);
  }

  const code = generateCode();
  const salt = randomBytes(8).toString("hex");
  const hash = hashCode(code, salt);
  const expiresAt = new Date(Date.now() + TTL_MINUTES * 60_000).toISOString();

  const { error: otpErr } = await admin.from("otp_codes").insert({
    event_id: opts.eventId,
    email: opts.email,
    code_hash: pack(salt, hash),
    expires_at: expiresAt,
  });
  if (otpErr) {
    throw new Error(`otp_insert_failed: ${otpErr.message}`);
  }

  return { code, guestId: guest.id };
}

type VerifyResult =
  | { ok: true; guestId: string }
  | { ok: false; reason: "no_code" | "expired" | "locked" | "wrong_code" };

// Constant-time compare on the salted hash; increments attempts on miss and
// locks the code after MAX_ATTEMPTS. On success, marks the OTP consumed and
// stamps guests.verified_at.
export async function verifyOtp(opts: {
  eventId: string;
  email: string;
  code: string;
}): Promise<VerifyResult> {
  const admin = createAdminClient();

  const { data: row, error } = await admin
    .from("otp_codes")
    .select("id, code_hash, expires_at, consumed_at, attempts")
    .eq("event_id", opts.eventId)
    .eq("email", opts.email)
    .is("consumed_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !row) return { ok: false, reason: "no_code" };
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return { ok: false, reason: "expired" };
  }
  if (row.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "locked" };

  const parts = unpack(row.code_hash);
  if (!parts) return { ok: false, reason: "no_code" };

  const expected = Buffer.from(parts.hash, "hex");
  const actual = Buffer.from(hashCode(opts.code, parts.salt), "hex");
  const match =
    expected.length === actual.length && timingSafeEqual(expected, actual);

  if (!match) {
    await admin
      .from("otp_codes")
      .update({ attempts: row.attempts + 1 })
      .eq("id", row.id);
    const remaining = MAX_ATTEMPTS - (row.attempts + 1);
    return {
      ok: false,
      reason: remaining <= 0 ? "locked" : "wrong_code",
    };
  }

  await admin
    .from("otp_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", row.id);

  const { data: guest, error: guestErr } = await admin
    .from("guests")
    .update({ verified_at: new Date().toISOString() })
    .eq("event_id", opts.eventId)
    .eq("email", opts.email)
    .select("id")
    .single();

  if (guestErr || !guest) return { ok: false, reason: "no_code" };
  return { ok: true, guestId: guest.id };
}
