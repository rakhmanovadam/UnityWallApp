"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function SignOutRow({ email }: { email: string }) {
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "flex-start",
        gap: 10,
        padding: "14px 20px 0",
      }}
    >
      <button
        type="button"
        className="btn btn--ghost btn--sm"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await supabase.auth.signOut();
          window.location.reload();
        }}
      >
        {busy ? "Signing out…" : "Sign out"}
      </button>
      <span className="microcopy" style={{ margin: 0 }}>
        Signed in as <strong>{email}</strong>
      </span>
    </div>
  );
}
