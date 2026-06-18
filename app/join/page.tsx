"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

function normalizeCode(input: string) {
  return input.trim().toUpperCase().replace(/\s+/g, "-");
}

export default function JoinManualPage() {
  const router = useRouter();
  const [code, setCode] = useState("");

  return (
    <section className="screen screen--pad screen--col">
      <span className="kicker kicker--dusk">Join a wall</span>
      <h1 className="display display--med">Enter your code</h1>
      <p className="lede">
        Find it on the table card, the invitation, or just under the QR.
      </p>

      <form
        id="code-form"
        className="form"
        onSubmit={(event) => {
          event.preventDefault();
          const normalized = normalizeCode(code);
          if (!normalized) return;
          router.push(`/join/${encodeURIComponent(normalized)}`);
        }}
      >
        <label className="label" htmlFor="join-code">
          Join code
        </label>
        <div className="field field--code">
          <input
            id="join-code"
            name="code"
            autoCapitalize="characters"
            autoComplete="off"
            inputMode="text"
            maxLength={14}
            placeholder="MAYA-DANIEL"
            required
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
        </div>
        <p className="microcopy">
          No code? Ask the host. Or{" "}
          <Link className="ulink" href="/">
            go back home
          </Link>
          .
        </p>
        <button
          type="submit"
          className="btn btn--primary"
          style={{ marginTop: 18 }}
        >
          Continue
        </button>
      </form>

      <div className="spacer" />
      <p className="microcopy center">
        Scanning a QR? It&apos;ll skip this step automatically.
      </p>
    </section>
  );
}
