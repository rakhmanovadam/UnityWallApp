import Link from "next/link";
import { notFound } from "next/navigation";
import { getLiveEventByCode } from "@/lib/db/events";
import { renderCoupleDisplay } from "@/lib/render";

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
        {/*
          couple_display is host-supplied. Render as React children (never
          innerHTML) to neutralize stored XSS. renderCoupleDisplay preserves
          the italic ampersand visual without ever taking an HTML string.
          See SECURITY.md for the original vulnerability write-up.
        */}
        <h1 className="display" id="join-who">
          {renderCoupleDisplay(event.couple_display)}
        </h1>
        <p className="quote">
          Tonight belongs to <span id="join-couple">{event.couple_display}</span>
          .
          <br />
          Help us remember it.
        </p>
        {event.welcome_message ? (
          // welcome_message is host-supplied plain text. Render as React
          // children so newlines are preserved (white-space: pre-wrap on the
          // element handles it) and no HTML can execute.
          <p
            className="welcome"
            style={{
              whiteSpace: "pre-wrap",
              marginTop: 12,
              color: "var(--dusk, #34455a)",
              fontStyle: "italic",
              lineHeight: 1.5,
            }}
          >
            {event.welcome_message}
          </p>
        ) : null}
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
