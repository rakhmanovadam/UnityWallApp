import Link from "next/link";
import { redirect } from "next/navigation";
import { getHostContext } from "@/lib/host-session";
import { qrSvg } from "@/lib/qr";
import { serverEnv } from "@/lib/env";
import { renderCoupleDisplay } from "@/lib/render";
import BackLink from "@/app/back-link";

export default async function CardPage() {
  const host = await getHostContext();
  if (!host) redirect("/dashboard");

  const event =
    host.events.find((e) => e.status === "live") ?? host.events[0];
  if (!event) redirect("/dashboard");

  const baseUrl = serverEnv().APP_BASE_URL.replace(/\/$/, "");
  const joinUrl = `${baseUrl}/join/${encodeURIComponent(event.code)}`;
  const qr = await qrSvg(joinUrl);

  return (
    <section className="screen screen--center screen--card">
      <BackLink href="/dashboard" label="Dashboard" />
      <div className="card-print">
        <span
          className="kicker kicker--dusk center"
          style={{ letterSpacing: ".28em" }}
        >
          Add to the wall
        </span>
        {/* Render couple_display as React children — not innerHTML — so a
            host-supplied string can never execute script on the print card. */}
        <h3 className="display display--med center">
          {renderCoupleDisplay(event.couple_display)}
        </h3>
        <p className="quote center">
          Tonight belongs to us. Help us remember it.
        </p>
        <div
          className="qr qr--lg"
          id="card-qr"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: qr }}
        />
        <div className="card-print__url">
          <div className="kicker">Scan, or visit</div>
          <div className="card-print__link">
            {joinUrl.replace(/^https?:\/\//, "")}
          </div>
        </div>
        <div className="powered powered--card">
          <span className="brandmark brandmark--xs" />
          <span>Powered by Unitywalls</span>
        </div>
      </div>
      <Link className="microcopy" href="/dashboard" style={{ marginTop: 24 }}>
        ← Back to dashboard
      </Link>
    </section>
  );
}
