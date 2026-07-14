"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function EmailForm({ code }: { code: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [optIn, setOptIn] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <form
      id="email-form"
      className="form"
      noValidate
      onSubmit={async (event) => {
        event.preventDefault();
        if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
          setError("Enter a valid email.");
          return;
        }
        setSubmitting(true);
        setError(null);
        try {
          // Stash for the verify screen — only the email itself is needed
          // there. Cookie-bound OTP record holds the source of truth.
          sessionStorage.setItem("uw:email", email.trim());
          const res = await fetch("/api/otp/request", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code,
              email: email.trim(),
              marketing_opt_in: optIn,
            }),
          });
          if (!res.ok) {
            const data = (await res.json().catch(() => ({}))) as {
              error?: string;
            };
            setError(
              data.error === "not_found"
                ? "This wall isn't live right now."
                : "Couldn't send the code. Try again in a minute.",
            );
            setSubmitting(false);
            return;
          }
          router.push(`/join/${encodeURIComponent(code)}/verify`);
        } catch {
          setError("Network error. Try again.");
          setSubmitting(false);
        }
      }}
    >
      <label className="label" htmlFor="email">
        Your email
      </label>
      <div className="field">
        <input
          id="email"
          name="email"
          inputMode="email"
          autoComplete="email"
          type="email"
          placeholder="you@email.com"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <label className="optin" htmlFor="optin">
        <input
          id="optin"
          name="optin"
          type="checkbox"
          checked={optIn}
          onChange={(e) => setOptIn(e.target.checked)}
        />
        <span className="optin__box" aria-hidden="true" />
        <span className="optin__text">
          Keep me posted with Unitywalls stories and updates.
        </span>
      </label>
      <p className="microcopy">
        We only ever email about your photos.{" "}
        <Link href="/privacy" className="ulink" target="_blank">
          Privacy note
        </Link>
      </p>
      {error ? (
        <p className="microcopy" style={{ color: "#b8443b", marginTop: 10 }}>
          {error}
        </p>
      ) : null}
      <button
        type="submit"
        className="btn btn--primary"
        style={{ marginTop: 22 }}
        disabled={submitting}
      >
        {submitting ? "Sending…" : "Continue"}
      </button>
    </form>
  );
}
