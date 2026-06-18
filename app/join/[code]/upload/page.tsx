import Link from "next/link";
import { notFound } from "next/navigation";
import { getLiveEventByCode } from "@/lib/db/events";
import UploadForm from "./form";

type Params = Promise<{ code: string }>;

export default async function JoinUploadPage({ params }: { params: Params }) {
  const { code } = await params;
  const event = await getLiveEventByCode(code);
  if (!event) notFound();

  return (
    <section className="screen screen--pad screen--col">
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
