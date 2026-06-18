import { notFound } from "next/navigation";
import { getLiveEventByCode } from "@/lib/db/events";
import EmailForm from "./form";

type Params = Promise<{ code: string }>;

export default async function JoinEmailPage({ params }: { params: Params }) {
  const { code } = await params;
  const event = await getLiveEventByCode(code);
  if (!event) notFound();

  return (
    <section className="screen screen--pad">
      <span className="kicker kicker--dusk">Sign the guestbook</span>
      <h1 className="display display--med">
        Leave your name
        <br />
        on the wall
      </h1>
      <p className="lede">
        So{" "}
        <span id="email-couple">{event.couple_display}</span> know whose eyes
        caught which moment.
      </p>
      <EmailForm code={event.code} />
    </section>
  );
}
