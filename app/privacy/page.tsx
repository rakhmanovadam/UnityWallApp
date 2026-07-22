import Link from "next/link";
import type { Metadata } from "next";
import BackLink from "@/app/back-link";

export const metadata: Metadata = {
  title: "Privacy Policy — Unitywalls",
  description: "How Unitywalls collects, uses, and deletes your data.",
};

// Static server component — reachable from the guest email step and the venue
// application. Describes the actual data flows in the app (email OTP, photo
// storage, retention purge). Not legal advice.
export default function PrivacyPage() {
  return (
    <section className="screen screen--scroll">
      <BackLink href="/" label="Home" />
      <header className="apply__head">
        <span className="kicker kicker--dusk">Legal</span>
        <h1 className="display display--sm">Privacy Policy</h1>
      </header>

      <div className="legal" style={{ maxWidth: 640, margin: "0 auto", lineHeight: 1.6 }}>
        <p className="microcopy">Last updated: July 9, 2026</p>

        <h2>1. What we collect</h2>
        <p>
          When you join a wall as a guest, we collect your email address (to
          verify you with a one-time code) and the photos you choose to upload.
          If you opt in, we also record that you&apos;d like occasional updates.
          When you apply to host, we collect the venue and contact details you
          submit in the form.
        </p>

        <h2>2. How we use it</h2>
        <p>
          We use your email to send the verification code and, for hosts,
          sign-in links and photo-retention reminders. We use uploaded photos
          only to display them on the event wall and to let the host download
          them. We never sell your data.
        </p>

        <h2>3. Email verification</h2>
        <p>
          Guest access uses a short-lived one-time code sent to your email. The
          code expires quickly and is tied to your session; we store a hash of
          it, not the code itself.
        </p>

        <h2>4. Photo storage and processing</h2>
        <p>
          Photos are stored in private buckets and served through short-lived
          signed links. On upload we strip embedded location and camera metadata
          (EXIF) and generate a display thumbnail. Only approved photos appear on
          a wall; hosts and moderators can remove any photo.
        </p>

        <h2>5. Retention and deletion</h2>
        <p>
          Photos are automatically deleted after the wall&apos;s retention window
          (60 days by default) following the event. When that window passes, the
          full-resolution originals, thumbnails, and the wall cover are purged
          and cannot be recovered. Hosts receive reminders 14 and 3 days before
          deletion so they can download an archive first.
        </p>

        <h2>6. Sharing with third parties</h2>
        <p>
          We rely on infrastructure providers to run Unitywalls — hosting and
          database (Supabase), transactional email (Resend), and our deployment
          platform (Vercel). They process data on our behalf under their own
          security commitments. We do not share your data with advertisers.
        </p>

        <h2>7. Your choices</h2>
        <p>
          You can opt out of marketing updates at any time. To request deletion
          of your data, or with any privacy question, email{" "}
          <a className="ulink" href="mailto:connect@unitywall.co">
            connect@unitywall.co
          </a>
          .
        </p>

        <h2>8. Changes</h2>
        <p>
          We may update this policy; material changes will be reflected in the
          &quot;last updated&quot; date above. See our{" "}
          <Link className="ulink" href="/terms">
            Terms of Service
          </Link>{" "}
          for the terms that govern use of the service.
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
