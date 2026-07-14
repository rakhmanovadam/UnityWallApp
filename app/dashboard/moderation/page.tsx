import Link from "next/link";
import { redirect } from "next/navigation";
import { getHostContext } from "@/lib/host-session";
import ModerationClient from "./client";
import BackLink from "@/app/back-link";

export default async function ModerationPage() {
  const host = await getHostContext();
  if (!host) redirect("/dashboard");

  const event = host.events.find((e) => e.status === "live") ?? host.events[0];
  if (!event) redirect("/dashboard");

  return (
    <section className="screen screen--scroll">
      <BackLink href="/dashboard" label="Dashboard" />
      <div className="host__top">
        <span className="kicker kicker--dusk">Moderation queue</span>
        <h1 className="display display--med">Review before it lands</h1>
        <p className="lede">
          New photos wait here whenever the &ldquo;review before posting&rdquo;
          toggle is on. Approve to send them to the wall, or reject to hide.
        </p>
      </div>

      <ModerationClient eventId={event.id} />

      <div style={{ marginTop: 24 }}>
        <Link className="ulink" href="/dashboard">
          ← Back to dashboard
        </Link>
      </div>
    </section>
  );
}
