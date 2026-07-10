import Link from "next/link";
import { notFound } from "next/navigation";
import { getLiveEventByCode, signedCoverUrl } from "@/lib/db/events";
import UploadForm from "./form";

type Params = Promise<{ code: string }>;

export default async function JoinUploadPage({ params }: { params: Params }) {
  const { code } = await params;
  const event = await getLiveEventByCode(code);
  if (!event) notFound();

  const bannerUrl = event.cover_image_path
    ? await signedCoverUrl(event.cover_image_path)
    : null;

  return (
    <section className="screen screen--pad screen--col screen--scroll">
      {bannerUrl ? (
        <img
          className="upload__banner"
          src={bannerUrl}
          alt={`${event.couple_display} banner`}
        />
      ) : null}
      <span className="kicker kicker--dusk">Add to the wall</span>
      <h1 className="display display--sm">Your photos</h1>

      <UploadForm code={event.code} />

      <div className="spacer" />
      <Link
        className="btn btn--secondary"
        href={`/join/${encodeURIComponent(event.code)}/wall`}
      >
        View the wall
      </Link>
    </section>
  );
}
