import Link from "next/link";
import { cookies } from "next/headers";
import BackLink from "@/app/back-link";

export default async function RequestSentPage() {
  const store = await cookies();
  const email = store.get("uw_apply_email")?.value ?? "you";

  return (
    <section className="screen screen--center">
      <BackLink href="/" label="Home" />
      <div className="ring">
        <span />
      </div>
      <span className="kicker kicker--dusk" style={{ marginTop: 30 }}>
        Received · thank you
      </span>
      <h1 className="display display--sm center">
        Your application
        <br />
        is under review
      </h1>
      <p className="lede center">
        We read every one by hand — usually within a day. We&apos;ll email{" "}
        <strong id="apply-email">{email}</strong> the moment you&apos;re
        approved, with your QR and dashboard.
      </p>
      <div className="pill">
        <span className="dot dot--amber" />
        QR withheld until approved
      </div>
      <Link className="microcopy" href="/" style={{ marginTop: 36 }}>
        ← Back to home
      </Link>
      <div className="powered powered--sub">
        <span className="brandmark brandmark--xs" />
        <span>Unitywalls</span>
      </div>
    </section>
  );
}
