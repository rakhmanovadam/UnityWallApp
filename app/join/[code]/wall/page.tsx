import { notFound } from "next/navigation";
import { getLiveEventByCode } from "@/lib/db/events";
import { listApprovedPhotos } from "@/lib/db/photos";
import WallClient from "./client";

type Params = Promise<{ code: string }>;

export default async function JoinWallPage({ params }: { params: Params }) {
  const { code } = await params;
  const event = await getLiveEventByCode(code);
  if (!event) notFound();

  const initial = await listApprovedPhotos({ eventId: event.id, limit: 30 });

  return (
    <WallClient
      eventId={event.id}
      code={event.code}
      coupleDisplay={event.couple_display}
      deleteAfter={event.delete_after}
      initialPhotos={initial.items}
      initialCursor={initial.next_cursor}
    />
  );
}
