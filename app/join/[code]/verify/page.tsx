import Link from "next/link";
import { notFound } from "next/navigation";
import { getLiveEventByCode } from "@/lib/db/events";
import VerifyForm from "./form";
import BackLink from "@/app/back-link";

type Params = Promise<{ code: string }>;

export default async function JoinVerifyPage({ params }: { params: Params }) {
  const { code } = await params;
  const event = await getLiveEventByCode(code);
  if (!event) notFound();

  return (
    <section className="screen screen--pad screen--col">
      <BackLink href={`/join/${encodeURIComponent(event.code)}/email`} />
      <div className="brand-tile" />
      <span className="kicker kicker--dusk" style={{ marginTop: 32 }}>
        Check your email
      </span>
      <h1 className="display display--med">Enter your code</h1>
      <VerifyForm code={event.code} />
      <div className="spacer" />
      <div className="center microcopy" style={{ marginTop: 14 }}>
        Wrong address?{" "}
        <Link
          href={`/join/${encodeURIComponent(event.code)}/email`}
          className="link-strong"
        >
          Edit email
        </Link>
      </div>
    </section>
  );
}
