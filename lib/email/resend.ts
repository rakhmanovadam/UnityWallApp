import { Resend } from "resend";
import { serverEnv } from "@/lib/env";

let cached: Resend | null = null;

function client() {
  if (cached) return cached;
  cached = new Resend(serverEnv().RESEND_API_KEY);
  return cached;
}

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

export async function sendEmail({ to, subject, html, text }: SendArgs) {
  const env = serverEnv();
  const result = await client().emails.send({
    from: env.RESEND_FROM,
    to,
    subject,
    html,
    text,
  });
  // Resend returns {data, error} — a silent-failure trap if the caller doesn't
  // check `error`. Throw here so failed sends surface at the API layer instead
  // of returning ok:true to guests whose codes never landed.
  if (result.error) {
    const msg =
      typeof result.error === "object" &&
      result.error !== null &&
      "message" in result.error
        ? String((result.error as { message: unknown }).message)
        : "resend_send_failed";
    throw new Error(`resend_send_failed: ${msg}`);
  }
  return result;
}

type LeadKind = "warm" | "hot" | "request";

export function leadNotificationEmail(opts: {
  source: LeadKind;
  email: string | null;
  name?: string | null;
  message?: string | null;
  eventCode?: string | null;
  utm?: Record<string, string> | null;
}) {
  const utmRows = opts.utm
    ? Object.entries(opts.utm)
        .map(
          ([k, v]) =>
            `<tr><td style="color:#666;font-size:12px;">${escape(k)}</td><td style="font-size:12px;">${escape(v)}</td></tr>`,
        )
        .join("")
    : "";
  return {
    subject: `UnityWall lead · ${opts.source}`,
    text: `New ${opts.source} lead
Email: ${opts.email ?? "—"}
Name: ${opts.name ?? "—"}
Event: ${opts.eventCode ?? "—"}
Message: ${opts.message ?? "—"}
UTM: ${opts.utm ? JSON.stringify(opts.utm) : "—"}
`,
    html: `
<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
    <tr><td>
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a6f5e;">New ${escape(opts.source)} lead</div>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;margin:8px 0 18px;">${escape(opts.email ?? "Anonymous")}</h1>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
        ${opts.name ? `<tr><td style="color:#888;width:120px;">Name</td><td>${escape(opts.name)}</td></tr>` : ""}
        ${opts.eventCode ? `<tr><td style="color:#888;">Event</td><td>${escape(opts.eventCode)}</td></tr>` : ""}
        ${opts.message ? `<tr><td style="color:#888;vertical-align:top;">Message</td><td>${escape(opts.message).replace(/\n/g, "<br>")}</td></tr>` : ""}
      </table>
      ${utmRows ? `<table style="width:100%;margin-top:12px;border-top:1px solid #eee;padding-top:12px;">${utmRows}</table>` : ""}
    </td></tr>
  </table>
</body></html>`.trim(),
  };
}

export function applicationNotificationEmail(opts: {
  venue: string;
  contact: string;
  email: string;
  phone?: string | null;
  city?: string | null;
  country?: string | null;
  notes?: string | null;
}) {
  return {
    subject: `UnityWall application · ${opts.venue}`,
    text: `New application
Venue: ${opts.venue}
Contact: ${opts.contact}
Email: ${opts.email}
Phone: ${opts.phone ?? "—"}
City: ${opts.city ?? "—"}
Country: ${opts.country ?? "—"}
Notes: ${opts.notes ?? "—"}
`,
    html: `
<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;">
    <tr><td>
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a6f5e;">New venue application</div>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:20px;margin:8px 0 18px;">${escape(opts.venue)}</h1>
      <table style="width:100%;border-collapse:collapse;font-size:14px;color:#333;">
        <tr><td style="color:#888;width:120px;">Contact</td><td>${escape(opts.contact)}</td></tr>
        <tr><td style="color:#888;">Email</td><td>${escape(opts.email)}</td></tr>
        ${opts.phone ? `<tr><td style="color:#888;">Phone</td><td>${escape(opts.phone)}</td></tr>` : ""}
        ${opts.city ? `<tr><td style="color:#888;">City</td><td>${escape(opts.city)}</td></tr>` : ""}
        ${opts.country ? `<tr><td style="color:#888;">Country</td><td>${escape(opts.country)}</td></tr>` : ""}
        ${opts.notes ? `<tr><td style="color:#888;vertical-align:top;">Notes</td><td>${escape(opts.notes).replace(/\n/g, "<br>")}</td></tr>` : ""}
      </table>
    </td></tr>
  </table>
</body></html>`.trim(),
  };
}

export function hostInviteEmail(opts: {
  venue: string;
  magicLink: string;
}) {
  return {
    subject: "You're approved — welcome to UnityWall",
    text: `Welcome aboard, ${opts.venue}.\n\nYour UnityWall dashboard is ready. Tap the link below to sign in. We never use passwords here — just one-tap magic links.\n\n${opts.magicLink}\n\nIf you need anything, reply to this email.\n\n— UnityWall`,
    html: `
<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;">
    <tr><td>
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a6f5e;">You're approved</div>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:8px 0 14px;">Welcome to UnityWall, ${escape(opts.venue)}</h1>
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 18px;">Your dashboard is ready. Tap the button below to sign in. No password — magic link only.</p>
      <p style="margin:24px 0;text-align:center;">
        <a href="${escape(opts.magicLink)}" style="display:inline-block;background:#222;color:#fff;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:600;">Open my dashboard</a>
      </p>
      <p style="font-size:12px;color:#888;margin:24px 0 0;">Link expires in 1 hour. If you need anything, just reply.</p>
    </td></tr>
  </table>
</body></html>`.trim(),
  };
}

export function applicationDeclineEmail(opts: {
  venue: string;
  contact: string;
  reason: string | null;
}) {
  const firstName = opts.contact.split(/\s+/)[0] || opts.contact;
  const reasonBlock = opts.reason
    ? `<p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 14px;"><strong>A note from the reviewer:</strong><br>${escape(
        opts.reason,
      ).replace(/\n/g, "<br>")}</p>`
    : "";
  const reasonText = opts.reason
    ? `\n\nA note from the reviewer:\n${opts.reason}\n`
    : "";
  return {
    subject: "About your UnityWall application",
    text: `Hi ${firstName},\n\nThanks for taking the time to apply with ${opts.venue}. After a careful look we aren't able to move ${opts.venue} forward as a UnityWall host at this time.${reasonText}\n\nYou're welcome to reapply once anything changes — reply to this email if you'd like to talk it through.\n\n— UnityWall · support@unitywall.co`,
    html: `
<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;">
    <tr><td>
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a6f5e;">Application update</div>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:8px 0 14px;">Thanks for applying, ${escape(firstName)}</h1>
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 14px;">We aren't able to move <strong>${escape(opts.venue)}</strong> forward as a UnityWall host at this time.</p>
      ${reasonBlock}
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 14px;">You're welcome to reapply once anything changes — hit reply if you'd like to talk it through.</p>
      <p style="font-size:13px;color:#888;margin:24px 0 0;">— UnityWall · support@unitywall.co</p>
    </td></tr>
  </table>
</body></html>`.trim(),
  };
}

export function applicationAckEmail(opts: { venue: string }) {
  return {
    subject: "We received your UnityWall application",
    text: `Hi — thanks for applying with ${opts.venue}.\n\nWe read every application by hand, usually within a day. We'll email you the moment you're approved with your dashboard and QR.\n\n— UnityWall`,
    html: `
<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;">
    <tr><td>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:0 0 16px;">We received your application</h1>
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 14px;">Thanks for applying with <strong>${escape(opts.venue)}</strong>. We read every one by hand, usually within a day.</p>
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 14px;">We'll email you the moment you're approved, with your dashboard and a QR for your tables.</p>
      <p style="font-size:13px;color:#888;margin:24px 0 0;">— UnityWall · support@unitywall.co</p>
    </td></tr>
  </table>
</body></html>`.trim(),
  };
}

function escape(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// One template at a time for now; later steps add leads, applications, and
// host-invite templates.
export function otpEmail(code: string) {
  return {
    subject: "Your UnityWall code",
    text: `Your UnityWall code: ${code}\n\nThis code expires in 10 minutes. If you didn't request it, ignore this email.`,
    html: `
<!doctype html>
<html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table cellpadding="0" cellspacing="0" border="0" style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;">
    <tr><td>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:22px;margin:0 0 16px;color:#222;">Your UnityWall code</h1>
      <p style="font-size:15px;line-height:1.5;color:#444;margin:0 0 18px;">Tap or type this six-digit code on the wall to confirm your email:</p>
      <div style="font-size:32px;letter-spacing:0.4em;text-align:center;font-weight:600;color:#222;padding:18px 0;background:#FAF7F2;border-radius:10px;">${code}</div>
      <p style="font-size:13px;color:#666;margin:24px 0 0;">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
      <p style="font-size:12px;color:#888;margin:24px 0 0;text-align:center;">— UnityWall</p>
    </td></tr>
  </table>
</body></html>`.trim(),
  };
}
