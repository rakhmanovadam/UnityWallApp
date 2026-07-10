"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function SignOutRow({ email }: { email: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);

  return (
    <p className="microcopy center">
      Signed in as <strong>{email}</strong> ·{" "}
      <button
        type="button"
        className="ulink"
        disabled={busy}
        style={{
          background: "none",
          border: "none",
          padding: 0,
          font: "inherit",
          cursor: "pointer",
        }}
        onClick={async () => {
          setBusy(true);
          await supabase.auth.signOut();
          window.location.reload();
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
    </p>
  );
}
