import { Fragment, type ReactNode } from "react";

// Renders a couple/venue display string as plain React children, so any
// script tags or event-handler attributes an attacker could put into the
// applications.venue / events.couple_display field are treated as text.
//
// The visual want is: names in the base font, the ampersand in italic
// (matches the Playfair Display styling). We split on " & " and render
// each ampersand as an <em>&amp;</em> element — not through innerHTML.
//
// Why this exists: `couple_display` and (previously) `couple_html` are
// mostly host- or applicant-supplied strings. Rendering them via
// dangerouslySetInnerHTML would give any applicant a stored-XSS primitive
// on the guest-facing /join/[code] wall. See SECURITY.md.
export function renderCoupleDisplay(source: string): ReactNode {
  if (!source) return null;
  const parts = source.split(/\s&\s/);
  const out: ReactNode[] = [];
  parts.forEach((part, i) => {
    if (i > 0) {
      out.push(
        <Fragment key={`amp-${i}`}>
          {" "}
          <em>&amp;</em>{" "}
        </Fragment>,
      );
    }
    out.push(<Fragment key={`p-${i}`}>{part}</Fragment>);
  });
  return out;
}
