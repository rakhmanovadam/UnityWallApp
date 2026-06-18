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
  return await client().emails.send({
    from: env.RESEND_FROM,
    to,
    subject,
    html,
    text,
  });
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
