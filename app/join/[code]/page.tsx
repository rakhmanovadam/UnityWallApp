import Link from "next/link";
import { notFound } from "next/navigation";
import { getLiveEventByCode } from "@/lib/db/events";

type Params = Promise<{ code: string }>;

export default async function JoinEventPage({ params }: { params: Params }) {
  const { code } = await params;
  const event = await getLiveEventByCode(code);
  if (!event) notFound();

  return (
    <section className="screen screen--join">
      <div className="join__top">
        <span className="kicker kicker--mute">A shared wall</span>
        <span className="kicker kicker--dusk join__brand">
          <span className="brandmark brandmark--xs" />
          UnityWall
        </span>
      </div>

      <div className="cover">
        <div className="cover__art cover__art--01" />
        <span className="cover__caption">— the first dance</span>
      </div>

      <div className="join__body">
        <span className="kicker kicker--dusk" id="join-when">
          {event.when_text}
        </span>
        <h1
          className="display"
          id="join-who"
          dangerouslySetInnerHTML={{ __html: event.couple_html }}
        />
        <p className="quote">
          Tonight belongs to <span id="join-couple">{event.couple_display}</span>
          .
          <br />
          Help us remember it.
        </p>
        <div className="spacer" />
        <Link
          href={`/join/${encodeURIComponent(event.code)}/email`}
          className="btn btn--primary"
        >
          Add your photos <span className="arrow">→</span>
        </Link>
        <div className="powered">
          <span className="brandmark brandmark--xs" />
          <span>Powered by UnityWall</span>
        </div>
      </div>
    </section>
  );
}
