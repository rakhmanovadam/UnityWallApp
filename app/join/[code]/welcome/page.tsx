import { notFound } from "next/navigation";
import { getLiveEventByCode } from "@/lib/db/events";
import WelcomeClient from "./client";

type Params = Promise<{ code: string }>;

export default async function JoinWelcomePage({ params }: { params: Params }) {
  const { code } = await params;
  const event = await getLiveEventByCode(code);
  if (!event) notFound();
  return <WelcomeClient code={event.code} />;
}
