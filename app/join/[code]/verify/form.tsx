"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const CELLS = 6;

export default function VerifyForm({ code }: { code: string }) {
  const router = useRouter();
  const [digits, setDigits] = useState<string[]>(() => Array(CELLS).fill(""));
  const [email, setEmail] = useState("your@email.com");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(24);
  const cellsRef = useRef<Array<HTMLInputElement | null>>([]);

  useEffect(() => {
    const stored = sessionStorage.getItem("uw:email");
    if (stored) setEmail(stored);
    cellsRef.current[0]?.focus();
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setInterval(() => setResendIn((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(t);
  }, [resendIn]);

  async function verify(otpString: string) {
    if (otpString.length !== CELLS) return;
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/otp/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, email, otp: otpString }),
      });
      if (res.ok) {
        router.push(`/join/${encodeURIComponent(code)}/welcome`);
        return;
      }
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (data.error === "locked") {
        setError("Too many attempts. Resend a code in a minute.");
      } else if (data.error === "expired") {
        setError("That code expired. Resend a new one.");
      } else {
        setError("Wrong code. Try again.");
      }
      setDigits(Array(CELLS).fill(""));
      cellsRef.current[0]?.focus();
    } catch {
      setError("Network error. Try again.");
    } finally {
      setSubmitting(false);
    }
  }

  function handleChange(i: number, value: string) {
    const v = value.replace(/\D/g, "").slice(0, 1);
    setDigits((prev) => {
      const next = [...prev];
      next[i] = v;
      const all = next.join("");
      if (v && i < CELLS - 1) cellsRef.current[i + 1]?.focus();
      if (all.length === CELLS && next.every((d) => d)) {
        setTimeout(() => verify(all), 50);
      }
      return next;
    });
  }

  function handleKeyDown(i: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Backspace" && !digits[i] && i > 0) {
      cellsRef.current[i - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "");
    if (text.length < CELLS) return;
    e.preventDefault();
    const next = Array.from({ length: CELLS }, (_, i) => text[i] ?? "");
    setDigits(next);
    cellsRef.current[CELLS - 1]?.focus();
    setTimeout(() => verify(next.join("")), 50);
  }

  async function resend() {
    if (resendIn > 0) return;
    setError(null);
    try {
      const res = await fetch("/api/otp/request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, email, marketing_opt_in: false }),
      });
      if (res.ok) setResendIn(24);
      else setError("Couldn't resend. Try again in a moment.");
    } catch {
      setError("Network error.");
    }
  }

  const timerLabel =
    resendIn > 0 ? `0:${String(resendIn).padStart(2, "0")}` : "now";

  return (
    <>
      <p className="lede">
        We sent a six-digit code to <strong id="verify-email">{email}</strong>
      </p>

      <div className="otp" role="group" aria-label="Six digit code">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              cellsRef.current[i] = el;
            }}
            className="otp__cell"
            inputMode="numeric"
            maxLength={1}
            data-i={i}
            aria-label={`Digit ${i + 1}`}
            value={d}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            onPaste={i === 0 ? handlePaste : undefined}
            disabled={submitting}
          />
        ))}
      </div>

      {error ? (
        <p className="microcopy" style={{ color: "#b8443b", marginTop: 12 }}>
          {error}
        </p>
      ) : null}

      <div className="resend">
        Didn&apos;t get it?{" "}
        <button
          type="button"
          className="ulink ulink--dusk"
          onClick={resend}
          disabled={resendIn > 0}
        >
          Resend in <span id="resend-timer">{timerLabel}</span>
        </button>
      </div>
    </>
  );
}
