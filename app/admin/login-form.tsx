"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/browser";

export default function AdminLoginForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      id="admin-login"
      className="form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
          setError("Enter a valid email.");
          return;
        }
        setSubmitting(true);
        setError(null);
        try {
          const supabase = createClient();
          const { error: signInError } = await supabase.auth.signInWithOtp({
            email: email.trim(),
            options: {
              emailRedirectTo: `${window.location.origin}/admin`,
            },
          });
          if (signInError) {
            setError("Couldn't send the link. Try again.");
            setSubmitting(false);
            return;
          }
          setSent(true);
        } catch {
          setError("Network error.");
        } finally {
          setSubmitting(false);
        }
      }}
    >
      <label className="label" htmlFor="admin-email">
        Team email
      </label>
      <div className="field">
        <input
          id="admin-email"
          name="email"
          type="email"
          autoComplete="email"
          placeholder="you@unitywall.co"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={sent}
        />
      </div>
      {error ? (
        <p className="microcopy" style={{ color: "#b8443b", marginTop: 10 }}>
          {error}
        </p>
      ) : null}
      {sent ? (
        <p className="microcopy" style={{ marginTop: 16 }}>
          Magic link sent. Open it on this device to land back here as admin.
        </p>
      ) : (
        <button
          type="submit"
          className="btn btn--primary"
          style={{ marginTop: 22 }}
          disabled={submitting}
        >
          {submitting ? "Sending…" : "Email me a magic link"}
        </button>
      )}
    </form>
  );
}
