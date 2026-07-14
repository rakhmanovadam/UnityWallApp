import Link from "next/link";
import type { Metadata } from "next";
import BackLink from "@/app/back-link";

export const metadata: Metadata = {
  title: "Terms of Service — Unitywalls",
  description: "The terms that govern hosting and using Unitywalls.",
};

// Plain-language hosting terms. Kept as a static server component so both the
// venue application form and search engines can reach it. Not legal advice —
// review with counsel before relying on it commercially.
export default function TermsPage() {
  return (
    <section className="screen screen--scroll">
      <BackLink href="/" label="Home" />
      <header className="apply__head">
        <span className="kicker kicker--dusk">Legal</span>
        <h1 className="display display--sm">Terms of Service</h1>
      </header>

      <div className="legal" style={{ maxWidth: 640, margin: "0 auto", lineHeight: 1.6 }}>
        <p className="microcopy">Last updated: July 9, 2026</p>

        <h2>1. What Unitywalls is</h2>
        <p>
          Unitywalls provides a QR-based shared photo wall for weddings and
          events. A host publishes a wall; guests scan a code, verify an email,
          and upload photos that appear on the live wall. These terms govern
          both hosting a wall and using one as a guest.
        </p>

        <h2>2. Hosting a wall</h2>
        <p>
          Hosts apply for access and are approved individually. As a host you
          are responsible for the event you run, for moderating the content that
          appears on your wall, and for having the right to invite your guests
          to participate. You agree not to use Unitywalls for any unlawful
          purpose or to solicit content that is illegal, harassing, or infringes
          someone else&apos;s rights.
        </p>

        <h2>3. Guest content</h2>
        <p>
          Guests retain ownership of the photos they upload. By uploading, a
          guest grants the event host and Unitywalls a limited license to store,
          process, display, and let the host download those photos for the
          purpose of running and delivering the event wall. Hosts and moderators
          may remove any photo at any time.
        </p>

        <h2>4. Acceptable use</h2>
        <p>
          Do not upload content you do not have the right to share, content
          depicting minors inappropriately, sexually explicit material, hate
          speech, or anything unlawful. We may remove content and suspend walls
          that violate these terms.
        </p>

        <h2>5. Retention and deletion</h2>
        <p>
          Photos are retained for the window configured on the wall (60 days by
          default) after the event ends, then automatically deleted. Hosts are
          reminded ahead of deletion and can download the full-resolution
          archive at any time before then. Once photos are purged they cannot be
          recovered. See our{" "}
          <Link className="ulink" href="/privacy">
            Privacy Policy
          </Link>{" "}
          for how we handle personal data.
        </p>

        <h2>6. Availability and liability</h2>
        <p>
          Unitywalls is provided &quot;as is.&quot; We work to keep the service
          available and your photos safe, but we do not guarantee uninterrupted
          service and are not liable for indirect or consequential losses to the
          extent permitted by law. Keep your own copy of anything you can&apos;t
          afford to lose.
        </p>

        <h2>7. Changes</h2>
        <p>
          We may update these terms. Material changes will be communicated to
          active hosts. Continued use after a change means you accept the updated
          terms.
        </p>

        <h2>8. Contact</h2>
        <p>
          Questions? Email{" "}
          <a className="ulink" href="mailto:support@unitywall.co">
            support@unitywall.co
          </a>
          .
        </p>

        <p style={{ marginTop: 32 }}>
          <Link className="microcopy" href="/">
            ← Back to home
          </Link>
        </p>
      </div>
    </section>
  );
}
