import type { ReactNode } from "react";
import { getLiveEventByCode } from "@/lib/db/events";
import { venueThemeStyle } from "@/lib/venue-theme";

type Params = Promise<{ code: string }>;

// Wraps every /join/[code]/* guest page in the venue's theme. The host-set
// colors + heading font become CSS custom-property overrides on a
// display:contents wrapper, so they cascade to the whole guest subtree without
// introducing a layout box of their own. An unknown/non-live code just renders
// children with the default theme (the pages themselves handle notFound()).
export default async function JoinLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Params;
}) {
  const { code } = await params;
  const event = await getLiveEventByCode(code);
  if (!event) return <>{children}</>;

  const style = { display: "contents", ...venueThemeStyle(event) };
  return <div style={style}>{children}</div>;
}
