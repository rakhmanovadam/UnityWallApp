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

// Company + app links appended to the bottom of every outbound email. The
// marketing site is a fixed domain; the public app URL comes from the env so
// it tracks whatever domain the app is deployed on.
const COMPANY_URL = "https://unitywall.co";
const COMPANY_NAME = "UnityWall Technological Solutions, LLC";

function emailFooter(appUrl: string) {
  const app = appUrl.replace(/\/$/, "");
  const html = `
  <table style="max-width:480px;margin:16px auto 0;border-top:1px solid #eee;padding-top:14px;">
    <tr><td style="text-align:center;font-family:Helvetica,Arial,sans-serif;font-size:12px;color:#888;line-height:1.6;">
      Visit <a href="${COMPANY_URL}" style="color:#3A5676;text-decoration:none;">${COMPANY_NAME}</a><br>
      Visit <a href="${app}" style="color:#3A5676;text-decoration:none;">Unitywalls</a>
    </td></tr>
  </table>`;
  const text = `\n\nVisit ${COMPANY_NAME}: ${COMPANY_URL}\nVisit Unitywalls: ${app}\n`;
  return { html, text };
}

export async function sendEmail({ to, subject, html, text }: SendArgs) {
  const env = serverEnv();
  const footer = emailFooter(env.APP_BASE_URL);
  // Slot the footer just before </body> so it lands inside the email shell;
  // fall back to appending if a template has no </body>.
  const htmlWithFooter = html.includes("</body>")
    ? html.replace("</body>", `${footer.html}</body>`)
    : `${html}${footer.html}`;
  const textWithFooter =
    text != null ? `${text}${footer.text}` : undefined;

  const result = await client().emails.send({
    from: env.RESEND_FROM,
    to,
    subject,
    html: htmlWithFooter,
    text: textWithFooter,
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
    subject: `Unitywalls lead · ${opts.source}`,
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
    subject: `Unitywalls application · ${opts.venue}`,
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
    subject: "You're approved — welcome to Unitywalls",
    text: `Welcome aboard, ${opts.venue}.\n\nYour Unitywalls dashboard is ready. Tap the link below to sign in. We never use passwords here — just one-tap magic links.\n\n${opts.magicLink}\n\nIf you need anything, reply to this email.\n\n— Unitywalls`,
    html: `
<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;">
    <tr><td>
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a6f5e;">You're approved</div>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:8px 0 14px;">Welcome to Unitywalls, ${escape(opts.venue)}</h1>
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

// Sign-in magic link for host/admin login. We generate the link server-side
// (admin.generateLink) and deliver it ourselves via Resend rather than relying
// on Supabase's built-in SMTP, which is rate-limited and unreliable.
export function signInEmail(opts: { magicLink: string; audience: "admin" | "host" }) {
  const where = opts.audience === "admin" ? "admin console" : "dashboard";
  return {
    subject: "Your Unitywalls sign-in link",
    text: `Tap the link below to sign in to your Unitywalls ${where}. No password — magic link only. It expires in 1 hour.\n\n${opts.magicLink}\n\nIf you didn't request this, ignore this email.\n\n— Unitywalls`,
    html: `
<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;">
    <tr><td>
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a6f5e;">Sign in</div>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:8px 0 14px;">Your Unitywalls sign-in link</h1>
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 18px;">Tap the button below to sign in to your ${where}. No password — magic link only.</p>
      <p style="margin:24px 0;text-align:center;">
        <a href="${escape(opts.magicLink)}" style="display:inline-block;background:#222;color:#fff;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:600;">Sign in to Unitywalls</a>
      </p>
      <p style="font-size:12px;color:#888;margin:24px 0 0;">Link expires in 1 hour. If you didn't request this, ignore this email.</p>
    </td></tr>
  </table>
</body></html>`.trim(),
  };
}

// Sent when an existing admin invites a new team member to the admin
// console. Access is invitation-only: the invitee's account is created (or
// promoted) with role=admin server-side, and this link signs them in.
export function adminInviteEmail(opts: {
  magicLink: string;
  invitedBy: string;
}) {
  return {
    subject: "You've been invited to the Unitywalls admin console",
    text: `${opts.invitedBy} invited you to the Unitywalls admin console.\n\nTap the link below to sign in. No password — magic link only. It expires in 1 hour; after that, request a fresh link from the admin sign-in page.\n\n${opts.magicLink}\n\nIf you weren't expecting this, ignore this email.\n\n— Unitywalls`,
    html: `
<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;">
    <tr><td>
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a6f5e;">Admin invitation</div>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:8px 0 14px;">You're invited to the admin console</h1>
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 18px;"><strong>${escape(opts.invitedBy)}</strong> added you to the Unitywalls admin team. Tap the button below to sign in. No password — magic link only.</p>
      <p style="margin:24px 0;text-align:center;">
        <a href="${escape(opts.magicLink)}" style="display:inline-block;background:#222;color:#fff;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:600;">Open the admin console</a>
      </p>
      <p style="font-size:12px;color:#888;margin:24px 0 0;">Link expires in 1 hour — after that, request a fresh one from the admin sign-in page. If you weren't expecting this, ignore this email.</p>
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
    subject: "About your Unitywalls application",
    text: `Hi ${firstName},\n\nThanks for taking the time to apply with ${opts.venue}. After a careful look we aren't able to move ${opts.venue} forward as a Unitywalls host at this time.${reasonText}\n\nYou're welcome to reapply once anything changes — reply to this email if you'd like to talk it through.\n\n— Unitywalls · connect@unitywall.co`,
    html: `
<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;">
    <tr><td>
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#7a6f5e;">Application update</div>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:8px 0 14px;">Thanks for applying, ${escape(firstName)}</h1>
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 14px;">We aren't able to move <strong>${escape(opts.venue)}</strong> forward as a Unitywalls host at this time.</p>
      ${reasonBlock}
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 14px;">You're welcome to reapply once anything changes — hit reply if you'd like to talk it through.</p>
      <p style="font-size:13px;color:#888;margin:24px 0 0;">— Unitywalls · connect@unitywall.co</p>
    </td></tr>
  </table>
</body></html>`.trim(),
  };
}

export function applicationAckEmail(opts: { venue: string }) {
  return {
    subject: "We received your Unitywalls application",
    text: `Hi — thanks for applying with ${opts.venue}.\n\nWe read every application by hand, usually within a day. We'll email you the moment you're approved with your dashboard and QR.\n\n— Unitywalls`,
    html: `
<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;">
    <tr><td>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:0 0 16px;">We received your application</h1>
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 14px;">Thanks for applying with <strong>${escape(opts.venue)}</strong>. We read every one by hand, usually within a day.</p>
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 14px;">We'll email you the moment you're approved, with your dashboard and a QR for your tables.</p>
      <p style="font-size:13px;color:#888;margin:24px 0 0;">— Unitywalls · connect@unitywall.co</p>
    </td></tr>
  </table>
</body></html>`.trim(),
  };
}

// Sent by the retention cron ahead of a wall's delete_after date so the host
// downloads their photos before the automatic purge. daysLeft is 14 or 3.
export function downloadReminderEmail(opts: {
  venue: string;
  daysLeft: number;
  deleteOn: string; // human date, e.g. "August 12, 2026"
  dashboardUrl: string;
}) {
  const urgent = opts.daysLeft <= 3;
  return {
    subject: urgent
      ? `Last chance — your Unitywalls closes in ${opts.daysLeft} days`
      : `Your Unitywalls closes in ${opts.daysLeft} days`,
    text: `Hi ${opts.venue},\n\nYour Unitywalls closes on ${opts.deleteOn} (${opts.daysLeft} days from now). When it closes the wall goes offline and every photo is permanently deleted. Download the full-resolution archive from your dashboard before then — once purged we can't recover them.\n\n${opts.dashboardUrl}\n\n— Unitywalls · connect@unitywall.co`,
    html: `
<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;">
    <tr><td>
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${urgent ? "#b8443b" : "#7a6f5e"};">${urgent ? "Final reminder" : "Closing reminder"}</div>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:8px 0 14px;">Your wall closes in ${opts.daysLeft} days</h1>
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 14px;">The wall for <strong>${escape(opts.venue)}</strong> closes on <strong>${escape(opts.deleteOn)}</strong> — it goes offline and every photo is permanently deleted. Download the full-resolution archive before then — once purged, the originals can't be recovered.</p>
      <p style="margin:24px 0;text-align:center;">
        <a href="${escape(opts.dashboardUrl)}" style="display:inline-block;background:#222;color:#fff;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:600;">Download my photos</a>
      </p>
      <p style="font-size:13px;color:#888;margin:24px 0 0;">— Unitywalls · connect@unitywall.co</p>
    </td></tr>
  </table>
</body></html>`.trim(),
  };
}

// Sent by the retention cron when fresh photos land on a wall that is already
// more than 30 days old. Hosts have usually stopped checking by then; guests
// often upload late, unaware the wall closes at delete_after. count is the
// number of new photos since the last alert.
export function lateActivityEmail(opts: {
  venue: string;
  count: number;
  deleteOn: string | null; // human date, or null if no delete_after set
  dashboardUrl: string;
}) {
  const n = opts.count;
  const photos = `${n} new photo${n === 1 ? "" : "s"}`;
  const closeLine = opts.deleteOn
    ? ` This wall closes on ${opts.deleteOn}, and every photo is permanently deleted then — download the archive before it does.`
    : "";
  return {
    subject: `${photos} just landed on your Unitywalls`,
    text: `Hi ${opts.venue},\n\nGuests are still adding to your wall — ${photos} arrived recently, more than 30 days after the event. People often upload late, so it's worth a look.${closeLine}\n\n${opts.dashboardUrl}\n\n— Unitywalls · connect@unitywall.co`,
    html: `
<!doctype html><html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;">
    <tr><td>
      <div style="font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:#3A5676;">Still coming in</div>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-size:22px;margin:8px 0 14px;">${escape(photos)} on your wall</h1>
      <p style="font-size:15px;line-height:1.55;color:#444;margin:0 0 14px;">Guests are still adding to <strong>${escape(opts.venue)}</strong> — ${escape(photos)} arrived recently, more than 30 days after the event. People often upload late, so it's worth a look.${opts.deleteOn ? ` This wall closes on <strong>${escape(opts.deleteOn)}</strong> and every photo is permanently deleted then — download the archive before it does.` : ""}</p>
      <p style="margin:24px 0;text-align:center;">
        <a href="${escape(opts.dashboardUrl)}" style="display:inline-block;background:#222;color:#fff;padding:14px 24px;border-radius:10px;text-decoration:none;font-weight:600;">See the new photos</a>
      </p>
      <p style="font-size:13px;color:#888;margin:24px 0 0;">— Unitywalls · connect@unitywall.co</p>
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
    subject: "Your Unitywalls code",
    text: `Your Unitywalls code: ${code}\n\nThis code expires in 10 minutes. If you didn't request it, ignore this email.`,
    html: `
<!doctype html>
<html><body style="font-family:Helvetica,Arial,sans-serif;background:#FAF7F2;padding:24px;">
  <table cellpadding="0" cellspacing="0" border="0" style="max-width:480px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;">
    <tr><td>
      <h1 style="font-family:'Playfair Display',Georgia,serif;font-weight:600;font-size:22px;margin:0 0 16px;color:#222;">Your Unitywalls code</h1>
      <p style="font-size:15px;line-height:1.5;color:#444;margin:0 0 18px;">Tap or type this six-digit code on the wall to confirm your email:</p>
      <div style="font-size:32px;letter-spacing:0.4em;text-align:center;font-weight:600;color:#222;padding:18px 0;background:#FAF7F2;border-radius:10px;">${code}</div>
      <p style="font-size:13px;color:#666;margin:24px 0 0;">This code expires in 10 minutes. If you didn't request it, ignore this email.</p>
      <p style="font-size:12px;color:#888;margin:24px 0 0;text-align:center;">— Unitywalls</p>
    </td></tr>
  </table>
</body></html>`.trim(),
  };
}
