"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

// Clear, consistent back control used on every page. Prefer an explicit parent
// `href` (predictable destination); when none is given it falls back to the
// browser's history back. Styled as a visible pill (.backlink) rather than a
// faint text link so it reads as a real button.
export default function BackLink({
  href,
  label = "Back",
}: {
  href?: string;
  label?: string;
}) {
  const router = useRouter();
  const content = (
    <>
      <span className="backlink__arrow" aria-hidden="true">
        ‹
      </span>
      {label}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="backlink">
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className="backlink" onClick={() => router.back()}>
      {content}
    </button>
  );
}
