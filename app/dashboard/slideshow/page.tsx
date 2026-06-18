import { redirect } from "next/navigation";
import { getHostContext } from "@/lib/host-session";
import { listApprovedPhotos } from "@/lib/db/photos";
import SlideshowClient from "./client";

export default async function SlideshowPage() {
  const host = await getHostContext();
  if (!host) redirect("/dashboard");

  const event =
    host.events.find((e) => e.status === "live") ?? host.events[0];
  if (!event) redirect("/dashboard");

  const initial = await listApprovedPhotos({ eventId: event.id, limit: 30 });

  return (
    <SlideshowClient
      eventId={event.id}
      coupleDisplay={event.couple_display}
      whenText={event.when_text}
      initialPhotos={initial.items}
    />
  );
}
