import { getHostContext } from "@/lib/host-session";
import { signedCoverUrl } from "@/lib/db/events";
import { qrSvg } from "@/lib/qr";
import { serverEnv } from "@/lib/env";
import HostLoginForm from "./login-form";
import HostDashboard from "./host-dashboard";

export default async function DashboardPage() {
  const host = await getHostContext();

  if (!host) {
    return (
      <section className="screen screen--pad screen--col">
        <span className="kicker kicker--dusk">Host login</span>
        <h1 className="display display--med">Welcome back</h1>
        <p className="lede">
          We&apos;ll email you a one-tap magic link — no passwords to remember.
        </p>
        <HostLoginForm />
        <p className="microcopy">
          Only approved hosts can sign in here. Not approved yet?{" "}
          <a className="ulink" href="/request">
            Apply to host
          </a>
          .
        </p>
        <div className="spacer" />
        <a className="microcopy center" href="/">
          ← Back to home
        </a>
      </section>
    );
  }

  // Pick the most recently created live event if present, else the first.
  const event = host.events.find((e) => e.status === "live") ?? host.events[0];

  if (!event) {
    return (
      <section className="screen screen--pad screen--col">
        <span className="kicker kicker--dusk">Host dashboard</span>
        <h1 className="display display--med">No events yet</h1>
        <p className="lede">
          Your application is approved but no event has been provisioned. Reach
          out at support@unitywall.co and we&apos;ll spin one up.
        </p>
        <p className="microcopy">Signed in as {host.email}</p>
      </section>
    );
  }

  const baseUrl = serverEnv().APP_BASE_URL.replace(/\/$/, "");
  const joinUrl = `${baseUrl}/join/${encodeURIComponent(event.code)}`;
  const qr = await qrSvg(joinUrl);
  const coverUrl = event.cover_image_path
    ? await signedCoverUrl(event.cover_image_path)
    : null;

  return (
    <HostDashboard
      event={event}
      hostEmail={host.email}
      joinUrl={joinUrl}
      qrSvg={qr}
      coverUrl={coverUrl}
    />
  );
}
