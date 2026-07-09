import { notFound } from "next/navigation";
import { getLiveEventByCode } from "@/lib/db/events";
import { getGuestSession } from "@/lib/guest-session";
import WelcomeClient from "./client";

type Params = Promise<{ code: string }>;

export default async function JoinWelcomePage({ params }: { params: Params }) {
  const { code } = await params;
  const event = await getLiveEventByCode(code);
  if (!event) notFound();

  // By this point the guest has passed the email + OTP gate (verify redirects
  // here), so the guest session carries their verified email. Pass it down so
  // the warm-scroll signal ties the lead to a real person instead of an
  // anonymous, un-countable row.
  const session = await getGuestSession();
  const verifiedEmail =
    session && session.event_id === event.id ? session.email : null;

  return <WelcomeClient code={event.code} verifiedEmail={verifiedEmail} />;
}
