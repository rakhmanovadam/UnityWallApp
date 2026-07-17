import Link from "next/link";
import { notFound } from "next/navigation";
import { getLiveEventByCode, signedCoverUrl } from "@/lib/db/events";
import { countGuestPhotos } from "@/lib/db/photos";
import { getGuestSession } from "@/lib/guest-session";
import UploadForm from "./form";
import BackLink from "@/app/back-link";
import ExpiryCountdown from "../expiry-countdown";

type Params = Promise<{ code: string }>;

export default async function JoinUploadPage({ params }: { params: Params }) {
  const { code } = await params;
  const event = await getLiveEventByCode(code);
  if (!event) notFound();

  const bannerUrl = event.cover_image_path
    ? await signedCoverUrl(event.cover_image_path)
    : null;

  // How many photos this guest has already landed, so the form can show their
  // remaining allowance against max_uploads_per_guest.
  const guest = await getGuestSession();
  const used =
    guest && guest.event_id === event.id
      ? await countGuestPhotos(event.id, guest.guest_id)
      : 0;

  return (
    <section className="screen screen--pad screen--col screen--scroll">
      <BackLink href={`/join/${encodeURIComponent(event.code)}/welcome`} />
      {bannerUrl ? (
        <img
          className="upload__banner"
          src={bannerUrl}
          alt={`${event.couple_display} banner`}
        />
      ) : null}
      <span className="kicker kicker--dusk">Add to the wall</span>
      <h1 className="display display--sm">Your photos</h1>
      <ExpiryCountdown deleteAfter={event.delete_after} />

      <UploadForm
        code={event.code}
        limit={event.max_uploads_per_guest}
        usedInitial={used}
      />

      {/* Fixed gap, not the flex:1 .spacer — otherwise a short queue leaves a
          big dead band before this button and the list stops mid-page. The
          list now flows straight into the button and the page scrolls. */}
      <div style={{ height: 28, flex: "0 0 auto" }} />
      <Link
        className="btn btn--secondary"
        href={`/join/${encodeURIComponent(event.code)}/wall`}
      >
        View the wall
      </Link>
    </section>
  );
}
